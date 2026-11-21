// Endereços desta VM que pertencem a outros projetos (convenções da VM): nenhuma ferramenta do Sante SGH publica
// porta nelas nem lê banco nelas. 3050 é o Firebird de outro projeto; 127.0.0.55:3306 é o banco de dev da Hal-AI.
// Melhoria: a lista mora nas ferramentas (configuração da VM), não no núcleo do produto.
export const PORTAS_OCUPADAS: readonly number[] = [
  631, 1720, 2000, 3050, 3105, 5038, 5060, 5275, 6435, 6436, 6480, 7070, 8088, 14178,
];
/** Endereço ocupado por host e porta. */
export const ENDERECOS_OCUPADOS: readonly string[] = ['127.0.0.55:3306'];
/** Containers de outros projetos que o Sante SGH nunca usa como destino nem para. */
export const CONTAINERS_ALHEIOS: readonly string[] = ['sante-firebird', 'halaidb-55', 'halai-asterisk'];
