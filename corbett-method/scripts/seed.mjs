// Idempotently create the Theresa & Anders acceptance job (and seed the price catalog if empty).
import { openDb } from '../server/db.js';
import { theresaAnders } from '../data/theresa-anders.seed.js';

const store = openDb();
if (store.getJob(theresaAnders.id)) console.log(`Job "${theresaAnders.name}" already exists — left unchanged.`);
else { store.insertJob(structuredClone(theresaAnders), 'seed', 'seeded from drawing 9/18/26 + signed estimate #20465'); console.log(`Created job "${theresaAnders.name}".`); }
console.log(`Catalog entries: ${store.catalogCount()}`);
store.close();
