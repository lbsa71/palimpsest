import type { EvolutionQueueItem } from './evolution-scheduler.ts';
import type { EvolutionReport } from './evolution.ts';
import type { GitPublisher, PublicationResult } from './git-publication.ts';
import type { Growth, Json } from './store.ts';
import { Store } from './store.ts';

const object=(value:Json|undefined):Record<string,Json>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value:{};
export interface ReleasePublicationOptions {
  store:Store;
  publisher?:Pick<GitPublisher,'publish'>;
  authorize:(growth:Growth)=>boolean;
  now?:()=>number;
  retryIntervalMs?:number;
}
/** Admission and publication are different durable effects. Reconciliation
 * belongs to every release, independently of any human result notification. */
export class ReleasePublication {
  readonly #options:ReleasePublicationOptions;
  readonly #retry:number;
  #active?:Promise<void>;
  constructor(options:ReleasePublicationOptions){
    this.#options=options;this.#retry=options.retryIntervalMs??30000;
    if(!Number.isSafeInteger(this.#retry)||this.#retry<1000)throw new Error('Invalid publication reconciliation interval');
  }
  get busy():boolean{return !!this.#active;}
  result(runId:string):PublicationResult|undefined {
    const event=this.#options.store.listEvents().filter(value=>value.type==='release.publication.result'&&object(value.payload).runId===runId).at(-1);
    return event?object(event.payload).result as unknown as PublicationResult:undefined;
  }
  pending(items:EvolutionQueueItem[]):boolean {
    return !!this.#options.publisher&&items.some(item=>item.state==='finished'&&item.result?.status==='promoted'&&this.result(item.id)?.status!=='published');
  }
  reconcile(items:EvolutionQueueItem[]):Promise<void>{
    if(this.#active)return this.#active;
    const work=Promise.resolve().then(()=>this.#run(items));this.#active=work;
    void work.finally(()=>{if(this.#active===work)this.#active=undefined;}).catch(()=>{});
    return work;
  }
  async #run(items:EvolutionQueueItem[]):Promise<void>{
    const {store,publisher}=this.#options;
    for(const item of items.filter(value=>value.state==='finished'&&value.result?.status==='promoted')){
      const events=store.listEvents();
      const last=events.filter(value=>value.type==='release.publication.result'&&object(value.payload).runId===item.id).at(-1);
      const prior=object(last?.payload);
      if(object(prior.result).status==='published')continue;
      const now=(this.#options.now??Date.now)();
      if(typeof prior.nextObservationAt==='number'&&prior.nextObservationAt>now)continue;
      const report=object(events.filter(value=>value.type==='evolution.finished'&&object(value.payload).runId===item.id).at(-1)?.payload).report as unknown as EvolutionReport|undefined;
      const growth=store.growth(item.growthId);
      let result:PublicationResult;
      if(!report?.candidate||report.status!=='promoted'||report.id!==item.id||report.growthId!==item.growthId)
        result={status:'declined',reason:'No exact recorded promoted release authorizes publication'};
      else if(!growth||!this.#options.authorize(growth))result={status:'declined',reason:'Current source policy withholds publication'};
      else if(!publisher)result={status:'declined',reason:'Git publication is disabled; no commit or push was performed'};
      else result=await publisher.publish(report.candidate);
      const observedAt=(this.#options.now??Date.now)();
      store.appendEvent('release.publication.result',JSON.parse(JSON.stringify({runId:item.id,candidateId:report?.candidate?.id??null,result,observedAt,nextObservationAt:observedAt+this.#retry})),growth?.sourceTaskId);
    }
  }
}
