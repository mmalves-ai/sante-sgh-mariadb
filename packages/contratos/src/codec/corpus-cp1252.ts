// Corpus do teste de CP1252 compartilhado pela tela (@sgh/ui) e pelo servidor (apps/api): o MESMO texto
// tem de ser aceito ou recusado igual nos dois lados (regra 6; seção 10 da ficha).
// Corpus sintético de nomes e termos clínicos (palavras comuns, nenhum dado de pessoa real).
export const CORPUS_CP1252: readonly string[] = [
  'Conceição Araújo Gonçalves',
  'João Estêvão Simões',
  'Íris Ângela Brandão',
  'Ülrich Zoë Ñúñez',
  'Hemorragia subaracnóidea',
  'Insuficiência cardíaca congestiva',
  'Pneumonia adquirida na comunidade — reavaliação em 48 h',
  'Paciente refere “dor torácica” há 2 dias…',
  'Glicemia 110 mg/dL; SpO₂ não aferida',
  'Dose: 2,5 µg/kg/min; temperatura 38,2 °C; 1º dia',
  'Alergia a dipirona • penicilina – confirmar',
  'Preço € 10 ‰ ™ © ® ± × ÷ ½ ¼ ¾ ¹ ² ³',
];

/** Do corpus, os que têm caractere fora do CP1252 (recusados nos dois lados). */
export const CORPUS_CP1252_RECUSADOS: readonly string[] = CORPUS_CP1252.filter((t) => t.includes('₂'));
