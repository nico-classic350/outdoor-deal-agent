import type { RunReport, SourceCoverage } from './types';

export type CoverageSnapshot = Pick<RunReport,
  'startedAt'|'finishedAt'|'attemptedSources'|'success'|'partial'|'browser'|'blocked'|'failed'|
  'rawOffers'|'normalizedOffers'|'confirmedSizeOffers'|'qualifiedDeals'|'nearMisses'> & {
  coverage: Pick<SourceCoverage,'sourceId'|'name'|'status'|'parsedOffers'|'pricedOffers'|'qualifiedOffers'>[];
};

export function coverageSnapshot(report: RunReport): CoverageSnapshot {
  return {
    startedAt: report.startedAt, finishedAt: report.finishedAt,
    attemptedSources: report.attemptedSources, success: report.success, partial: report.partial,
    browser: report.browser, blocked: report.blocked, failed: report.failed,
    rawOffers: report.rawOffers, normalizedOffers: report.normalizedOffers,
    confirmedSizeOffers: report.confirmedSizeOffers, qualifiedDeals: report.qualifiedDeals,
    nearMisses: report.nearMisses,
    coverage: report.coverage.map(c => ({sourceId:c.sourceId,name:c.name,status:c.status,
      parsedOffers:c.parsedOffers,pricedOffers:c.pricedOffers,qualifiedOffers:c.qualifiedOffers})),
  };
}

export function comparisonBaseline(previous: {run_key?:unknown;report?:any}, runDate:string):RunReport|CoverageSnapshot {
  return String(previous.run_key)===runDate ? previous.report.comparison?.baseline??previous.report : previous.report;
}

const count = (value: number | undefined) => Number.isFinite(value) ? Number(value) : null;
const diff = (current: number | undefined, prior: number | undefined) =>
  count(current) === null || count(prior) === null ? null : Number(current) - Number(prior);

export function compareCoverage(current: RunReport, previous: RunReport | CoverageSnapshot) {
  const old = coverageSnapshot(previous as RunReport);
  const oldSources = new Map(old.coverage.map(c => [c.sourceId,c]));
  const reached = (r: RunReport | CoverageSnapshot) => r.success + r.partial + r.browser;
  const productSources = (r: RunReport | CoverageSnapshot) => r.coverage.filter(c => c.parsedOffers > 0).length;
  const row = (metric: keyof RunReport, now: number, before: number | undefined) =>
    ({metric, current:now, previous:count(before), delta:diff(now,before)});
  return {
    baseline: old,
    baselineKind: old.startedAt.slice(0,10)===current.startedAt.slice(0,10) ? 'same-day-rerun' : 'previous-day',
    metrics: [
      row('attemptedSources',current.attemptedSources,old.attemptedSources),
      {metric:'reachedSources',current:reached(current),previous:reached(old),delta:reached(current)-reached(old)},
      {metric:'sourcesWithProducts',current:productSources(current),previous:productSources(old),delta:productSources(current)-productSources(old)},
      ...(['success','partial','browser','blocked','failed','rawOffers','normalizedOffers','confirmedSizeOffers','qualifiedDeals','nearMisses'] as const)
        .map(key=>row(key,Number(current[key]??0),old[key])),
    ],
    sources: current.coverage.map(c => {
      const prior=oldSources.get(c.sourceId);
      return {sourceId:c.sourceId,name:c.name,status:c.status,previousStatus:prior?.status??null,
        parsedOffers:c.parsedOffers,previousParsedOffers:count(prior?.parsedOffers),parsedDelta:diff(c.parsedOffers,prior?.parsedOffers),
        pricedOffers:count(c.pricedOffers),previousPricedOffers:count(prior?.pricedOffers),pricedDelta:diff(c.pricedOffers,prior?.pricedOffers),
        qualifiedOffers:count(c.qualifiedOffers),previousQualifiedOffers:count(prior?.qualifiedOffers),
        qualifiedDelta:diff(c.qualifiedOffers,prior?.qualifiedOffers)};
    }),
  };
}
