// Product definitions (what can be purchased). Package sizes that have not been
// specified are null — the engine raises a product_spec question instead of guessing.
import { LUMBER_GROUPS } from './rules.js';

export const PRODUCTS = {
  'concrete:fast-set:50lb':        { name: 'Fast-setting concrete, 50 lb bag', category: 'concrete', unit: 'bag', packageSize: 1, packageUnit: 'bag' },
  'soil:basic-organic':            { name: 'Basic organic garden soil (below top 12")', category: 'soil', unit: 'cy', packageSize: 0.25, packageUnit: 'cy' },
  'soil:premium-organic':          { name: 'Premium organic garden soil (top 12")', category: 'soil', unit: 'cy', packageSize: 0.25, packageUnit: 'cy' },
  'compost:cow:1cf':               { name: 'Organic cow compost, 1 cu ft bag', category: 'soil', unit: 'bag', packageSize: 1, packageUnit: 'bag' },
  'liner:6mil-black:20x100':       { name: 'Black 6-mil plastic, 20 × 100 ft roll (Menards)', category: 'liner', unit: 'roll', packageSize: 1, packageUnit: 'roll' },
  'staple:liner':                  { name: 'Staples for liner (type/package TBD)', category: 'fastener', unit: 'ea', packageSize: null, packageUnit: 'box' },
  'screw:deck:3in':                { name: '3" deck screws (package TBD)', category: 'fastener', unit: 'ea', packageSize: null, packageUnit: 'box' },
  'screw:trim':                    { name: 'Trim screws (type/length/package TBD)', category: 'fastener', unit: 'ea', packageSize: null, packageUnit: 'box' },
  'mesh:welded-6x6-0187':          { name: 'Carbon-steel welded mesh, 6×6" grid, ~5.813" openings, 0.187" wire (panel size TBD)', category: 'trellis', unit: 'sqft', packageSize: null, packageUnit: 'panel' },
  'mesh:attachment':               { name: 'Mesh attachment hardware (TBD)', category: 'trellis', unit: 'ea', packageSize: null, packageUnit: 'box' },
  'aggregate:landscape-gravel':    { name: 'Landscape gravel (path base, 3")', category: 'hardscape', unit: 'cy', packageSize: null, packageUnit: 'cy' },
  'aggregate:decomposed-granite':  { name: 'Decomposed granite (1.5" top layer)', category: 'hardscape', unit: 'cy', packageSize: null, packageUnit: 'cy' },
  'fabric:landscape':              { name: 'Landscape fabric (roll size TBD)', category: 'hardscape', unit: 'sqft', packageSize: null, packageUnit: 'roll' },
  'edging:snap-edge:8ft':          { name: 'Black paver snap-edge, 8 ft stick', category: 'hardscape', unit: 'ea', packageSize: 1, packageUnit: 'stick' },
  'edging:spike:10in':             { name: '10" edging spike', category: 'hardscape', unit: 'ea', packageSize: null, packageUnit: 'box' },
  'paver:unilock:beacon-hill-smooth:granite-fusion': { name: 'Unilock Beacon Hill Smooth — Granite Fusion', category: 'hardscape', unit: 'sqft', packageSize: null, packageUnit: 'pallet' },
  'paver:unilock:copthorne:basalt': { name: 'Unilock Copthorne — Basalt (border, per signed proposal)', category: 'hardscape', unit: 'lf', packageSize: null, packageUnit: 'pallet' },
  'paver:unilock:courtstone:basalt':{ name: 'Unilock Courtstone — Basalt (border, per updated drawing)', category: 'hardscape', unit: 'lf', packageSize: null, packageUnit: 'pallet' },
  'coping:unilock:umbriano:midnight-sky': { name: 'Unilock Umbriano coping — Midnight Sky', category: 'hardscape', unit: 'lf', packageSize: null, packageUnit: 'piece' },
  'mulch:blue-slate-chip':         { name: 'Blue slate chip mulch', category: 'planting', unit: 'cy', packageSize: null, packageUnit: 'cy' },
  'rock:dog-area':                 { name: 'Rock for dog area (type TBD)', category: 'hardscape', unit: 'cy', packageSize: null, packageUnit: 'cy' },
  'drain:tile-4in':                { name: '4" drain tile', category: 'drainage', unit: 'lf', packageSize: null, packageUnit: 'roll' },
  'drain:fittings':                { name: 'Drain tile fittings (downspout + sump connections)', category: 'drainage', unit: 'ea', packageSize: 1, packageUnit: 'ea' },
  'plant:karl-foerster':           { name: 'Karl Foerster feather reed grass', category: 'plants', unit: 'ea', packageSize: 1, packageUnit: 'ea' },
  'plant:allium':                  { name: 'Allium', category: 'plants', unit: 'ea', packageSize: 1, packageUnit: 'ea' },
  'plant:quick-fire-hydrangea':    { name: 'Quick Fire hydrangea', category: 'plants', unit: 'ea', packageSize: 1, packageUnit: 'ea' },
  'mesh:rebar-grid':               { name: 'Basic rebar mesh grid (proposal option; panel size TBD)', category: 'trellis', unit: 'sqft', packageSize: null, packageUnit: 'panel' },
  'assembly:screen-panel':         { name: "4' custom AC screen panels (lumber list waits on panel detail)", category: 'screens', unit: 'lf', packageSize: null, packageUnit: 'lf' },
  'assembly:dog-fence':            { name: "4' dog fence matching AC panels (lumber list waits on panel detail)", category: 'screens', unit: 'lf', packageSize: null, packageUnit: 'lf' },
  'irrigation:system':             { name: 'Irrigation components (layout pending)', category: 'irrigation', unit: 'ea', packageSize: null, packageUnit: 'ea' },
  'lighting:system':               { name: 'Lighting components (layout pending)', category: 'lighting', unit: 'ea', packageSize: null, packageUnit: 'ea' },
  'disposal:demolition':           { name: 'Demolition disposal / hauling', category: 'disposal', unit: 'load', packageSize: null, packageUnit: 'load' },
};

export function lumberProductKey(groupKey, ft) { return `${groupKey}:${ft}`; }

export function parseLumberKey(key) {
  const m = /^(lumber:[^:]+:[^:]+):(\d+)$/.exec(key);
  return m ? { groupKey: m[1], lengthFt: Number(m[2]) } : null;
}

export function productInfo(key) {
  if (PRODUCTS[key]) return PRODUCTS[key];
  const l = parseLumberKey(key);
  if (l && LUMBER_GROUPS[l.groupKey]) {
    const g = LUMBER_GROUPS[l.groupKey];
    const special = g.specialOrderFt.includes(l.lengthFt);
    return { name: `${g.label} × ${l.lengthFt}'${special ? ' (special order)' : ''}`, category: 'lumber', unit: 'board',
             packageSize: 1, packageUnit: 'board', specialOrder: special };
  }
  return { name: key, category: 'other', unit: 'ea', packageSize: null, packageUnit: 'ea' };
}

export function productName(key) { return productInfo(key).name; }
