export const EXAM_CATALOG = [
  { category: 'Hematologia', items: [
    'Compatibilidade sanguínea','Contagem de plaquetas','Contagem de reticulócitos','Fibrinogênio','Hematócrito','Hemograma','Placa leucocitária','Pesquisa de hematozoário','Hemogasometria'
  ]},
  { category: 'Análise fecal', items: ['Parasitológico de fezes','Tripsina fecal'] },
  { category: 'Urinálises', items: ['Razão Gama-GT/creatinina','Razão proteína/creatinina','Urinálise completa'] },
  { category: 'Citologia', items: ['Citologia de ouvido','Citologia de pele','Citologia oncológica'] },
  { category: 'Parasitologia', items: ['Raspado','Tricografia'] },
  { category: 'Testes rápidos', items: ['Cinomose','FIV/FELV (alere)','Giardia','Parvovirose','Snap 4DX'] },
  { category: 'Sorologias', items: ['Leishmaniose','Toxoplasmose'] },
  { category: 'Bioquímica', items: [
    'Albumina','ALT/TGP','Amilase','AST/TGO','Bilirrubina e frações','Cálcio iônico','Cloreto','Colesterol total','Creatinina','Creatinofosfoquinase','Ferro','Fosfatase alcalina','Fósforo','Gama-GT','Glicose','LDH – Lactato desidrogenase','Lactato','Lipase','Potássio','Proteína e frações','pH sanguíneo','Sódio','Triglicerídeos','Ureia'
  ]},
  { category: 'Fluidos biológicos', items: ['Efusão cavitária','Líquor','Punção de medula'] }
];

export const MATERIALS = ['Sangue total','Soro','Plasma','Urina','Fezes'];

export function catalogWithCodes() {
  return EXAM_CATALOG.map((g, gi) => ({
    category: g.category,
    items: g.items.map((name, ii) => ({ code: `E${String(gi+1).padStart(2,'0')}${String(ii+1).padStart(2,'0')}`, name }))
  }));
}
