import { identity, invariant } from '../../../contracts/common.ts';
import { OperationalStore } from '../../../storage/index.ts';
import { SlackError } from '../client.ts';
import type { SlackApi, SlackPage } from '../client.ts';
import { SlackIngress } from '../ingress/index.ts';

interface Scan {channel:string;threadTs?:string;oldest:string;latest:string;cursor:string;seenCursors:string[]}
export interface RecoveryGap {id:string;channel:string;threadTs?:string;kind:'permission'|'retention'|'coverage'|'protocol';detail:string;at:string}
export interface RecoveryState {cycle?:{latest:string;oldest:string;queue:Scan[];current?:Scan;seenThreads:string[]};lastCompleted?:string;retryAt?:number;gaps:RecoveryGap[]}
export interface RecoveryOptions {store:OperationalStore;api:SlackApi;ingress:SlackIngress;coverageStart:string;lookbackSeconds:number;retentionFloor?:string;maxPagesPerTick?:number;pageSize?:number;now?:()=>number}
/** Every page's admissions and cursor advance share the same SQLite transaction. */
export class SlackRecovery {
  readonly options:RecoveryOptions; private ticking=false;
  constructor(options:RecoveryOptions){
    this.options=options;
    invariant(Number.isFinite(Number(options.coverageStart))&&Number(options.coverageStart)>=0&&Number.isFinite(options.lookbackSeconds)&&options.lookbackSeconds>0,'explicit bounded recovery coverage required');
    invariant(Number.isSafeInteger(options.maxPagesPerTick??4)&&(options.maxPagesPerTick??4)>0,'positive recovery page bound required');
    invariant(Number.isSafeInteger(options.pageSize??100)&&(options.pageSize??100)>0&&(options.pageSize??100)<=1000,'invalid recovery page size');
    invariant(options.retentionFloor===undefined||(Number.isFinite(Number(options.retentionFloor))&&Number(options.retentionFloor)>=0),'invalid retention floor');
  }
  state():RecoveryState{return this.options.store.get<RecoveryState>('communications.slack.recovery',this.options.ingress.options.teamId)?.value??{gaps:[]};}
  private save(state:RecoveryState):void {const key=this.options.ingress.options.teamId,row=this.options.store.get('communications.slack.recovery',key);this.options.store.put('communications.slack.recovery',key,state,row?.revision??null);}
  private gap(state:RecoveryState,scan:Scan,kind:RecoveryGap['kind'],detail:string):void {
    const id=identity({channel:scan.channel,threadTs:scan.threadTs??null,kind,detail});
    if(!state.gaps.some(g=>g.id===id)){
      const gap={id,channel:scan.channel,...(scan.threadTs?{threadTs:scan.threadTs}:{}),kind,detail,at:new Date((this.options.now??Date.now)()).toISOString()};state.gaps.push(gap);
      const scope=this.options.ingress.options.channels.find(c=>c.channel===scan.channel)?.scope;
      invariant(scope,'recovery channel grant absent');
      const eventId=`slack-gap:${this.options.ingress.options.teamId}:${id}`;
      // The scheduler can surface this scoped observation through an explicit speech effect.
      // Stable gap identities avoid repeated notifications from every recovery cycle.
      if(!this.options.store.events('communications').some(e=>e.id===eventId))this.options.store.append({id:eventId,stream:'communications',type:'recovery-gap',data:{gap,scope}});
    }
  }
  async tick(signal?:AbortSignal):Promise<{pages:number;complete:boolean;retryAt?:number}> {
    invariant(!this.ticking,'recovery tick already active');this.ticking=true;
    try {
      const now=(this.options.now??Date.now)();let state=this.state();
      if(state.retryAt && state.retryAt>now)return {pages:0,complete:false,retryAt:state.retryAt};
      if(state.retryAt!==undefined){delete state.retryAt;this.save(state);}
      if(!state.cycle){
        const latest=String(now/1000),oldest=String(Math.max(Number(this.options.coverageStart),now/1000-this.options.lookbackSeconds));
        const queue:Scan[]=this.options.ingress.options.channels.map(c=>({channel:c.channel,oldest,latest,cursor:'',seenCursors:[]}));
        const threads=this.options.ingress.threads();
        for(const thread of threads)queue.push({channel:thread.channel,threadTs:thread.threadTs,oldest,latest,cursor:'',seenCursors:[]});
        state.cycle={latest,oldest,queue,seenThreads:threads.map(t=>`${t.channel}:${t.threadTs}`)};
        for(const scan of queue.filter(s=>!s.threadTs)){
          if(this.options.retentionFloor===undefined)this.gap(state,scan,'retention','retention coverage is unverified; Slack may silently omit deleted or expired messages');
          else if(Number(this.options.retentionFloor)>Number(oldest))this.gap(state,scan,'retention',`configured retention floor ${this.options.retentionFloor} exceeds requested history start ${oldest}`);
        }
        if(Number(oldest)>Number(state.lastCompleted??this.options.coverageStart))for(const scan of queue.filter(s=>!s.threadTs))this.gap(state,scan,'coverage',`history before ${oldest} is outside the configured lookback; first offline mentions in older threads are not guaranteed`);
        this.save(state);
      }
      let pages=0;
      while(pages<(this.options.maxPagesPerTick??4)){
        signal?.throwIfAborted();state=this.state();const cycle=state.cycle!;
        const scan=cycle.current??cycle.queue.shift();if(!scan){state.lastCompleted=cycle.latest;delete state.cycle;this.save(state);return {pages,complete:true};}
        cycle.current=scan;this.save(state);
        let page:SlackPage;
        try {page=await this.options.api.call<SlackPage>(scan.threadTs?'conversations.replies':'conversations.history',{channel:scan.channel,...(scan.threadTs?{ts:scan.threadTs}:{}),oldest:scan.oldest,latest:scan.latest,inclusive:'true',limit:String(this.options.pageSize??100),...(scan.cursor?{cursor:scan.cursor}:{})},signal);}
        catch(error){state=this.state();const current=state.cycle!.current!;
          if(error instanceof SlackError && error.code==='ratelimited'){state.retryAt=now+(error.retryAfterMs??1000);this.save(state);return {pages,complete:false,retryAt:state.retryAt};}
          if(error instanceof SlackError && error.code==='invalid_cursor'){current.cursor='';current.seenCursors=[];this.gap(state,current,'protocol','invalid cursor; restarting the same bounded window');this.save(state);return {pages,complete:false};}
          if(error instanceof SlackError && ['missing_scope','not_in_channel','channel_not_found','thread_not_found','access_denied'].includes(error.code)){this.gap(state,current,'permission',error.code);delete state.cycle!.current;this.save(state);pages++;continue;}
          this.gap(state,current,'protocol',error instanceof SlackError?error.code:'history request failed');state.retryAt=now+1000;this.save(state);return {pages,complete:false,retryAt:state.retryAt};
        }
        pages++;
        this.options.store.transaction(()=>{
          state=this.state();const c=state.cycle!,current=c.current!;
          invariant(Array.isArray(page.messages),'Slack history messages missing');
          if(page.is_limited)this.gap(state,current,'retention','Slack marked history as limited; missing messages cannot be reconstructed');
          // Parent then replies chronologically: an offline mention joins before later ordinary replies.
          for(const message of [...page.messages].sort((a,b)=>Number(a.ts)-Number(b.ts))){
            this.options.ingress.acceptHistory(current.channel,message);
            if(!current.threadTs && (message.reply_count??0)>0){const threadTs=message.thread_ts??message.ts,key=`${current.channel}:${threadTs}`;if(!c.seenThreads.includes(key)){c.seenThreads.push(key);c.queue.push({channel:current.channel,threadTs,oldest:c.oldest,latest:c.latest,cursor:'',seenCursors:[]});}}
          }
          const next=page.response_metadata?.next_cursor?.trim()??'';
          if(next){if(current.seenCursors.includes(next)||next===current.cursor){this.gap(state,current,'protocol','pagination cursor repeated; coverage incomplete');delete c.current;}else{current.seenCursors.push(next);current.cursor=next;}}
          else {if(page.has_more)this.gap(state,current,'protocol','has_more without a cursor; coverage incomplete');delete c.current;}
          this.save(state);
        });
      }
      return {pages,complete:false};
    }finally{this.ticking=false;}
  }
}
