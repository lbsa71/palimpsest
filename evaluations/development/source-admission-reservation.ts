import { types } from 'node:util';
import { canonicalJson, digest, identity, invariant, type ArtifactRef } from '../../packages/contracts/index.ts';
import { hashBytes } from '../../packages/release/artifacts.ts';
import { inertSnapshot } from '../qualification/manifest.ts';
import type { DevelopmentAcquisitionPlan } from './acquisition-plan.ts';
import { validateSourceAdmissionPolicy, validateDevelopmentWorkload, type SourceAdmissionPolicy, type SourceAdmissionTrust } from './development-source-admission.ts';

export interface SourceComposition {
  version: 1; layout: 'source-admission-fixed-54-v1'; maxExtractedBytes: number;
  support: { ordinal: 52 | 53; purpose: string; maxBytes: number; expected: ArtifactRef | null }[];
}
export interface RecorderSourceAdmission { policy: SourceAdmissionPolicy; trust: SourceAdmissionTrust; composition: SourceComposition; acceptedCompositionDigest: string }
export interface SourceAdmissionReservation {
  digest: string; composition: SourceComposition;
  slots: {ordinal:number;maxBytes:number}[];
  originals: {ordinal:number;artifact:ArtifactRef;bytes:number}[];
  ownerBytes: number; observationBytes: number; signedObservationBytes: number;
}
const exact = (v: object, keys: string) => invariant(Object.keys(v).sort().join(',') === keys.split(',').sort().join(','), 'Exact source composition fields required');
function fields(value: unknown): Record<string, unknown> {
  invariant(value && typeof value === 'object' && !types.isProxy(value), 'Plain admission descriptor required');
  invariant(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null, 'Plain admission descriptor required');
  const out: Record<string, unknown> = Object.create(null);
  for (const k of Reflect.ownKeys(value)) { invariant(typeof k === 'string', 'Admission symbols forbidden'); const d = Object.getOwnPropertyDescriptor(value,k)!; invariant('value' in d && d.enumerable, 'Admission accessors forbidden'); out[k]=d.value; }
  return out;
}
/** Detach before any callback/property use; a native key is copied without overridable methods. */
export function detachRecorderSourceAdmission(value: RecorderSourceAdmission): RecorderSourceAdmission {
  const input=fields(value); exact(input,'policy,trust,composition,acceptedCompositionDigest');
  const t=fields(input.trust); exact(t,'acceptedPolicyDigest,acceptedQualificationDigest,checker,acceptedClockQualificationDigest');
  let checker:SourceAdmissionTrust['checker']=null;
  if(t.checker!==null){const c=fields(t.checker);exact(c,'id,key,principalId,independenceGroup');const key=c.key;
    invariant(key&&typeof key==='object'&&!types.isProxy(key)&&types.isUint8Array(key)&&(Object.getPrototypeOf(key)===Uint8Array.prototype||Object.getPrototypeOf(key)===Buffer.prototype),'Native plain checker key required');
    invariant(Reflect.ownKeys(key).every(k=>typeof k==='string'&&/^(0|[1-9][0-9]*)$/.test(k)),'Checker key properties forbidden');
    const n=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype),'length')!.get!.call(key) as number; invariant(n>=32&&n<=1024,'Bounded native checker key required');
    const copied=new Uint8Array(n);Uint8Array.prototype.set.call(copied,key as Uint8Array);
    checker={...inertSnapshot({id:c.id,principalId:c.principalId,independenceGroup:c.independenceGroup}),key:copied} as NonNullable<SourceAdmissionTrust['checker']>;
  }
  const snapshot=inertSnapshot({...input,trust:{...t,checker:null}}) as RecorderSourceAdmission;
  return {...snapshot,trust:{...snapshot.trust,checker}};
}
export function reserveSourceAdmission(plan:DevelopmentAcquisitionPlan, rawInput:RecorderSourceAdmission, read:(ref:ArtifactRef,max:number)=>Uint8Array):SourceAdmissionReservation {
  const a=detachRecorderSourceAdmission(rawInput),c=a.composition,p=a.policy,l=plan.captureLayout;
  invariant(plan.version===2&&l,'Source admission requires complete paged plan');
  exact(c,'version,layout,maxExtractedBytes,support');digest(a.acceptedCompositionDigest);
  invariant(c.version===1&&c.layout==='source-admission-fixed-54-v1'&&a.acceptedCompositionDigest===identity(c),'Unaccepted source composition');
  const q=Math.min(l.proofPool.mandatoryArtifactBytes,p.bounds.maxProofBytes);
  invariant(Number.isSafeInteger(c.maxExtractedBytes)&&c.maxExtractedBytes>0&&c.maxExtractedBytes<=q,'Bounded extracted composition bytes required');
  invariant(Array.isArray(c.support)&&c.support.length<=2&&new Set(c.support.map(x=>x.ordinal)).size===c.support.length,'At most two accepted support slots');
  for(const s of c.support){exact(s,'ordinal,purpose,maxBytes,expected');invariant([52,53].includes(s.ordinal)&&typeof s.purpose==='string'&&s.purpose.length>0&&s.purpose.length<=256&&Number.isSafeInteger(s.maxBytes)&&s.maxBytes>0&&s.maxBytes<=q,'Bounded accepted support required');if(s.expected){exact(s.expected,'uri,sha256');digest(s.expected.sha256);invariant(s.expected.uri===`sha256:${s.expected.sha256}`,'Retained public support required');}}
  const context={plan,policy:p,trust:a.trust,readArtifact:read};validateSourceAdmissionPolicy(context);
  invariant(p.bounds.maxMetadataRecords<=l.page.maxPhysicalRows*4&&p.bounds.maxMetadataBytes<=l.page.maxConservativeBytes*4,'Finite source metadata extraction ceiling required');
  const o=p.adaptationOrdinals;invariant(o.policy===0&&o.workload===(p.workload?1:null)&&o.qualification===(p.qualification?2:null)&&o.clockQualification===(p.clockQualification?3:null),'Fixed source policy ordinals required');
  const slots:{ordinal:number;maxBytes:number}[]=[],add=(ordinal:number,maxBytes=q)=>slots.push({ordinal,maxBytes});
  add(0);if(p.workload){
    const w=validateDevelopmentWorkload(context),transfers=plan.manifest.value.opportunities.filter(x=>x.family==='transfer');
    invariant(identity(o.learningChecks)===identity(transfers.map((x,i)=>({opportunityId:x.id,ordinal:4+i}))),'Fixed learning receipt ordinals required');
    const scripts=plan.manifest.value.controls.filter(x=>!['no-memory','no-standing-goals'].includes(x.kind));
    const expected=scripts.flatMap((s,i)=>{const map=w.scripts.find(x=>x.controlId===s.id);invariant(map,'Exact registered script mapping required');return map.cases.map((x,k)=>({controlId:s.id,assignmentId:x.assignmentId,ordinal:7+3*i+k}));});
    invariant(identity(o.scriptChecks)===identity(expected),'Fixed script receipt ordinals required');
    for(let j=1;j<52;j++)add(j,j>=4&&j<16?p.bounds.maxCheckerBytes:q);
    const checker=a.trust.checker;invariant(checker&&checker.id===p.checkerId&&p.qualification?.sha256===a.trust.acceptedQualificationDigest,'Pinned public checker authority required');
    const bytes=read(p.qualification!,q);invariant(bytes.byteLength<=q&&hashBytes(bytes)===p.qualification!.sha256,'Exact checker qualification bytes required');const certificate=inertSnapshot(JSON.parse(Buffer.from(bytes).toString()));
    exact(certificate,'version,checkerId,checkerSourceDigest,extractorSourceDigest,rubricDigest,workloadDigest,principalId,independenceGroup,disposition');
    invariant(canonicalJson(certificate)===Buffer.from(bytes).toString()&&certificate.version===1&&certificate.disposition==='accepted'&&certificate.checkerId===checker.id&&certificate.principalId===checker.principalId&&certificate.independenceGroup===checker.independenceGroup&&certificate.workloadDigest===p.workload.sha256&&certificate.checkerSourceDigest===p.checkerSourceDigest&&certificate.extractorSourceDigest===p.extractorSourceDigest&&certificate.rubricDigest===p.rubricDigest,'Public checker qualification binding differs');
  }else if(p.clockQualification)add(3);
  for(const s of c.support)add(s.ordinal,s.maxBytes);
  invariant(slots.length+l.proofPool.mandatoryArtifacts<=l.proofPool.maxArtifacts&&slots.reduce((n,s)=>n+s.maxBytes,0)+l.proofPool.mandatoryArtifacts*l.proofPool.mandatoryArtifactBytes<=l.proofPool.maxBytes,'Source admission optional reservations cannot fit unchanged proof pool');
  const originals:SourceAdmissionReservation['originals']=[];
  const policyBytes=Buffer.from(canonicalJson(p));invariant(policyBytes.byteLength<=q,'Policy singleton exceeds proof reserve');const sha256=hashBytes(policyBytes);originals.push({ordinal:0,artifact:{uri:`sha256:${sha256}`,sha256},bytes:policyBytes.byteLength});
  for(const [ordinal,artifact]of [[1,p.workload],[2,p.qualification],[3,p.clockQualification]]as const)if(artifact){const b=read(artifact,q);invariant(b.byteLength<=q&&hashBytes(b)===artifact.sha256,'Exact admitted policy original differs');originals.push({ordinal,artifact,bytes:b.byteLength});}
  const admissionDigest=identity({policy:p,acceptedPolicyDigest:a.trust.acceptedPolicyDigest,checker:a.trust.checker?{id:a.trust.checker.id,principalId:a.trust.checker.principalId,independenceGroup:a.trust.checker.independenceGroup,keyDigest:hashBytes(a.trust.checker.key)}:null,acceptedQualificationDigest:a.trust.acceptedQualificationDigest,acceptedClockQualificationDigest:a.trust.acceptedClockQualificationDigest,composition:c,acceptedCompositionDigest:a.acceptedCompositionDigest});
  const size=(v:unknown)=>Buffer.byteLength(canonicalJson(v)),zero='0'.repeat(64),ref={uri:`sha256:${zero}`,sha256:zero},id='\u0000'.repeat(256),at='9999-12-31T23:59:59.999Z';
  const role=plan.registration.value.roles.find(r=>r.kind==='candidate')!.id;
  const wires:{id:string;data:Record<string,string>}[]=plan.manifest.value.cycles.map(subject=>({id:`source:cycle:${role}:${subject}`,data:{kind:'cycle',assignmentId:subject,runId:id,selectionId:id}}));
  if(p.workload)for(const subject of new Set(plan.manifest.value.opportunities.flatMap(o=>o.interferenceIds)))wires.push({id:`source:experience:${role}:${subject}`,data:{kind:'experience',assignmentId:subject,episodeId:id}});
  const wrappers=wires.map(wire=>({source:'host-source-admission',planDigest:zero,id:wire.id,observedAt:at,data:wire.data,proof:ref,sourceAdmissionDigest:admissionDigest}));
  const signed=wires.map(wire=>({value:{version:1,id:wire.id,attemptDigest:zero,configurationDigest:zero,candidateId:plan.manifest.value.candidate.id,observedAt:at,artifact:ref,data:wire.data},signer:plan.manifest.value.observerId,signature:zero}));
  const observationId=wires.map(wire=>wire.id).reduce((a,b)=>size(a)>size(b)?a:b);
  const index={key:canonicalJson(['experience',id,id]),selectorDigest:zero,proof:ref,kind:'adaptation',ordinal:53,observationId,status:'recorded',code:'\u0000'.repeat(256)};
  const pending={key:index.key,selectorDigest:zero,planned:Array.from({length:8},()=>({artifact:ref,bytes:q,kind:'adaptation',ordinal:53}))};
  const prepared={controlId:id,selectorDigest:zero,scriptCases:Array.from({length:3},()=>({assignment:{roleId:id,assignmentId:id,before:ref,after:ref},feedback:{roleId:id,assignmentId:id,before:ref,after:ref},checker:ref}))};
  return {digest:admissionDigest,composition:inertSnapshot(c),slots,originals,ownerBytes:size({sourceAdmissionStoreDigest:zero,sourceAdmissionDigest:admissionDigest,sourceComposition:c,sourceReservations:slots,admissions:Array.from({length:56},()=>index),preparedControls:Array.from({length:5},()=>prepared),admissionPending:pending}),observationBytes:Math.max(...wrappers.map(size)),signedObservationBytes:Math.max(...signed.map(size))};
}
