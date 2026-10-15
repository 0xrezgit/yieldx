import type { Opportunity } from '../../types/opportunity';
import { simplifyCurve } from '../opportunity/curve';

/**
 * What /api/lending sends: every opportunity, unchanged except its rate curves, which
 * keep only the points that change the line `curveAt` interpolates (simplifyCurve) —
 * the curves were two thirds of the response (101 samples each).
 */
export function leanOpportunity(o: Opportunity): Opportunity {
  const supply = o.supplyCurve ? { ...o.supplyCurve, points: simplifyCurve(o.supplyCurve.points) } : o.supplyCurve;
  const borrowCurve = o.borrow?.curve ? { ...o.borrow.curve, points: simplifyCurve(o.borrow.curve.points) } : o.borrow?.curve;
  if (supply === o.supplyCurve && borrowCurve === o.borrow?.curve) return o;
  return { ...o, supplyCurve: supply, ...(o.borrow ? { borrow: { ...o.borrow, curve: borrowCurve ?? null } } : {}) };
}
