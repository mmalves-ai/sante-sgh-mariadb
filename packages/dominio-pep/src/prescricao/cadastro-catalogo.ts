// Cadastro editável do catálogo da prescrição (03-PEP L106): frequências de administração, condições "se
// necessário", itens não padronizados e os complementos do item (frequências aceitas, regras por setor, sinônimos de
// busca e pares conflitantes). Regras puras: o banco só guarda o que passou aqui. Nada é apagado: tirar de uso marca
// o registro (ativo = false ou excluído com autor e hora) e o histórico continua ligado às prescrições já feitas.

export const TIPOS_FREQUENCIA = [
  'intervalo',
  'vezes_ao_dia',
  'continuo',
  'agora',
  'se_necessario',
  'dias_semana',
  'dose_unica',
  'a_criterio_medico',
] as const;
export type TipoFrequencia = (typeof TIPOS_FREQUENCIA)[number];

export const USOS_FREQUENCIA = ['todos', 'medicamento', 'cuidado', 'dieta', 'procedimento'] as const;
export const ESCOPOS_SETOR_FREQUENCIA = ['todos', 'somente_listados', 'exceto_listados'] as const;
export const DIAS_SEMANA_FREQUENCIA = [
  'domingo',
  'segunda',
  'terca',
  'quarta',
  'quinta',
  'sexta',
  'sabado',
] as const;
export type DiaSemana = (typeof DIAS_SEMANA_FREQUENCIA)[number];
export const ORIGENS_SINONIMO = [
  'nome_comercial',
  'principio_ativo',
  'apelido',
  'abreviatura',
  'classe_terapeutica',
  'outro',
] as const;
export const GRAVIDADES_CONFLITO = ['alerta', 'impeditivo'] as const;

/** Um problema de validação: código estável e o campo da tela, para a validação na hora. */
export interface ProblemaCadastro {
  readonly codigo: string;
  readonly campo: string;
}

/** Código interno: maiúsculas sem acento, letras, números, ponto, barra, hífen e sublinhado (até 30). */
export function normalizarCodigoCatalogo(bruto: string): string {
  return bruto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '_')
    .replace(/[^A-Z0-9._/-]/g, '')
    .slice(0, 30);
}

/** Termo de busca: espaços colapsados, sem espaço nas pontas (a comparação de duplicidade ignora caixa e acento). */
export function normalizarTermo(bruto: string): string {
  return bruto.replace(/\s+/g, ' ').trim();
}
export function chaveDoTermo(termo: string): string {
  return normalizarTermo(termo).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export interface EntradaFrequencia {
  readonly codigo: string;
  readonly descricao: string;
  readonly descricaoResumida: string | null;
  readonly tipo: TipoFrequencia;
  readonly intervaloMinutos: number | null;
  readonly dosesPorDia: number | null;
  readonly limiteHoras: number | null;
  readonly horarioFixo: boolean;
  readonly uso: (typeof USOS_FREQUENCIA)[number];
  readonly dias: readonly DiaSemana[];
  readonly escopoSetor: (typeof ESCOPOS_SETOR_FREQUENCIA)[number];
  readonly setores: readonly number[];
}

const MINUTOS_SEMANA = 7 * 24 * 60;

/**
 * Coerência da frequência: o intervalo pede minutos (até uma semana) e o "vezes ao dia" pede de 1 a 48 doses; os
 * outros tipos não levam intervalo nem doses (o horário sairia de um número que a frequência não usa). Dias da semana
 * pede ao menos um dia; dose única e agora pedem a validade em horas. A lista de setores só existe quando o escopo
 * é por lista, e não fica vazia nesse caso. Horário fixo (grade do setor) só faz sentido com doses no dia.
 */
export function problemasDaFrequencia(e: EntradaFrequencia): ProblemaCadastro[] {
  const p: ProblemaCadastro[] = [];
  const add = (codigo: string, campo: string) => p.push({ codigo, campo });
  if (!normalizarCodigoCatalogo(e.codigo)) add('codigo-obrigatorio', 'codigo');
  if (!e.descricao.trim()) add('descricao-obrigatoria', 'descricao');
  if (e.descricaoResumida !== null && e.descricaoResumida.trim().length > 15)
    add('resumo-longo', 'descricaoResumida');
  const intervalo = e.tipo === 'intervalo';
  const vezes = e.tipo === 'vezes_ao_dia';
  if (intervalo && !(e.intervaloMinutos && e.intervaloMinutos > 0 && e.intervaloMinutos <= MINUTOS_SEMANA))
    add('intervalo-invalido', 'intervaloMinutos');
  if (!intervalo && e.intervaloMinutos !== null) add('intervalo-sem-uso', 'intervaloMinutos');
  if (
    vezes &&
    !(e.dosesPorDia && Number.isInteger(e.dosesPorDia) && e.dosesPorDia >= 1 && e.dosesPorDia <= 48)
  )
    add('doses-invalidas', 'dosesPorDia');
  if (!vezes && !intervalo && e.dosesPorDia !== null) add('doses-sem-uso', 'dosesPorDia');
  if (e.tipo === 'dias_semana' && e.dias.length === 0) add('dias-obrigatorios', 'dias');
  if ((e.tipo === 'dose_unica' || e.tipo === 'agora') && !(e.limiteHoras && e.limiteHoras > 0))
    add('validade-obrigatoria', 'limiteHoras');
  if (e.horarioFixo && !(intervalo || vezes)) add('horario-fixo-sem-doses', 'horarioFixo');
  if (e.escopoSetor === 'todos' && e.setores.length > 0) add('setores-sem-escopo', 'setores');
  if (e.escopoSetor !== 'todos' && e.setores.length === 0) add('setores-obrigatorios', 'setores');
  if (new Set(e.setores).size !== e.setores.length) add('setor-repetido', 'setores');
  return p;
}

/** Doses no dia derivadas do intervalo (24 h / intervalo, quando divide o dia), para a grade de horários. */
export function dosesDaFrequencia(e: Pick<EntradaFrequencia, 'tipo' | 'intervaloMinutos' | 'dosesPorDia'>) {
  if (e.tipo === 'vezes_ao_dia') return e.dosesPorDia;
  if (e.tipo === 'intervalo' && e.intervaloMinutos && (24 * 60) % e.intervaloMinutos === 0)
    return (24 * 60) / e.intervaloMinutos;
  return null;
}

export interface EntradaCondicaoSeNecessario {
  readonly codigo: string;
  readonly descricao: string;
  readonly parametroVital: number | null;
  readonly limiar: number | null;
}

/** A condição "se necessário" com disparo pelo sinal vital leva o parâmetro e o limiar juntos (um sem o outro não dispara). */
export function problemasDaCondicao(e: EntradaCondicaoSeNecessario): ProblemaCadastro[] {
  const p: ProblemaCadastro[] = [];
  if (!normalizarCodigoCatalogo(e.codigo)) p.push({ codigo: 'codigo-obrigatorio', campo: 'codigo' });
  if (!e.descricao.trim()) p.push({ codigo: 'descricao-obrigatoria', campo: 'descricao' });
  if ((e.parametroVital === null) !== (e.limiar === null))
    p.push({ codigo: 'disparo-incompleto', campo: e.parametroVital === null ? 'parametroVital' : 'limiar' });
  return p;
}

export interface EntradaNaoPadronizado {
  readonly descricao: string;
  readonly tipoItem: number;
  readonly unidade: number | null;
  readonly principioAtivo: number | null;
  readonly vias: readonly number[];
  readonly justificativa: string;
}

/**
 * O item não padronizado entra para a prescrição pontual com a justificativa (a farmácia avalia a compra). Sem
 * unidade e sem via não há como prescrever a dose; vias repetidas são recusadas.
 */
export function problemasDoNaoPadronizado(e: EntradaNaoPadronizado): ProblemaCadastro[] {
  const p: ProblemaCadastro[] = [];
  if (e.descricao.trim().length < 3) p.push({ codigo: 'descricao-curta', campo: 'descricao' });
  if (e.unidade === null) p.push({ codigo: 'unidade-obrigatoria', campo: 'unidade' });
  if (e.vias.length === 0) p.push({ codigo: 'via-obrigatoria', campo: 'vias' });
  if (new Set(e.vias).size !== e.vias.length) p.push({ codigo: 'via-repetida', campo: 'vias' });
  if (e.justificativa.trim().length < 10) p.push({ codigo: 'justificativa-curta', campo: 'justificativa' });
  return p;
}

/** Código do item não padronizado: NP- seguido do próximo número (único no cliente). */
export function codigoNaoPadronizado(proximo: number): string {
  return `NP-${String(proximo).padStart(6, '0')}`;
}

export interface EntradaRegraSetor {
  readonly setor: number | null;
  readonly local: number | null;
  readonly padronizado: boolean;
  readonly usoRestrito: boolean;
  readonly bloqueado: boolean;
  readonly motivoBloqueio: string | null;
  readonly via: number | null;
  readonly frequencia: number | null;
  readonly quantidadePadrao: number | null;
  readonly dosePadrao: number | null;
}

/** A regra do item no setor: bloqueio só com motivo, sala só dentro de um setor, quantidades positivas. */
export function problemasDaRegraSetor(e: EntradaRegraSetor): ProblemaCadastro[] {
  const p: ProblemaCadastro[] = [];
  if (e.bloqueado && !(e.motivoBloqueio ?? '').trim())
    p.push({ codigo: 'bloqueio-sem-motivo', campo: 'motivoBloqueio' });
  if (e.local !== null && e.setor === null) p.push({ codigo: 'local-sem-setor', campo: 'local' });
  if (e.usoRestrito && e.setor === null) p.push({ codigo: 'restrito-sem-setor', campo: 'setor' });
  if (e.quantidadePadrao !== null && !(e.quantidadePadrao > 0))
    p.push({ codigo: 'quantidade-invalida', campo: 'quantidadePadrao' });
  if (e.dosePadrao !== null && !(e.dosePadrao > 0)) p.push({ codigo: 'dose-invalida', campo: 'dosePadrao' });
  return p;
}

/** Sinônimo: termo de 2 a 100 letras, que não repete (sem caixa nem acento) o nome do item nem outro sinônimo ativo. */
export function problemasDoSinonimo(
  termo: string,
  nomeDoItem: string,
  existentes: readonly string[],
): ProblemaCadastro[] {
  const t = normalizarTermo(termo);
  if (t.length < 2 || t.length > 100) return [{ codigo: 'termo-invalido', campo: 'termo' }];
  const k = chaveDoTermo(t);
  if (k === chaveDoTermo(nomeDoItem) || existentes.some((x) => chaveDoTermo(x) === k))
    return [{ codigo: 'termo-repetido', campo: 'termo' }];
  return [];
}

/** Próxima sequência do sinônimo do item (a maior já usada + 1, contando os excluídos, que não são reaproveitados). */
export function proximaSequenciaSinonimo(usadas: readonly number[]): number {
  return usadas.reduce((m, x) => Math.max(m, x), 0) + 1;
}

/**
 * Par conflitante: um item não conflita consigo; o par é simétrico, então A×B e B×A são o mesmo conflito (o segundo é
 * recusado). O motivo é obrigatório no impeditivo (quem prescreve precisa saber por que não pode).
 */
export function problemasDoConflito(
  item: number,
  conflitante: number,
  gravidade: (typeof GRAVIDADES_CONFLITO)[number],
  motivo: string | null,
  paresAtivos: readonly (readonly [number, number])[],
): ProblemaCadastro[] {
  if (item === conflitante) return [{ codigo: 'conflito-consigo', campo: 'conflitante' }];
  const p: ProblemaCadastro[] = [];
  if (paresAtivos.some(([a, b]) => (a === item && b === conflitante) || (a === conflitante && b === item)))
    p.push({ codigo: 'conflito-repetido', campo: 'conflitante' });
  if (gravidade === 'impeditivo' && !(motivo ?? '').trim())
    p.push({ codigo: 'motivo-obrigatorio', campo: 'motivo' });
  return p;
}

/** Mensagens em português de cada código, para a tela e para a recusa da API. */
export const MENSAGENS_CADASTRO_CATALOGO: Readonly<Record<string, string>> = {
  'codigo-obrigatorio': 'Informe o código.',
  'codigo-repetido': 'Já existe um cadastro com este código.',
  'descricao-obrigatoria': 'Informe a descrição.',
  'resumo-longo': 'A descrição resumida tem até 15 letras.',
  'intervalo-invalido': 'Informe o intervalo em minutos (até uma semana).',
  'intervalo-sem-uso': 'Só a frequência por intervalo leva o intervalo.',
  'doses-invalidas': 'Informe de 1 a 48 doses por dia.',
  'doses-sem-uso': 'Este tipo de frequência não leva número de doses.',
  'dias-obrigatorios': 'Marque ao menos um dia da semana.',
  'validade-obrigatoria': 'Informe a validade em horas.',
  'horario-fixo-sem-doses': 'Horário fixo só vale para frequência com doses no dia.',
  'setores-sem-escopo': 'Escolha se a lista de setores é de inclusão ou de exclusão.',
  'setores-obrigatorios': 'Informe ao menos um setor.',
  'setor-repetido': 'Setor repetido na lista.',
  'disparo-incompleto': 'O disparo pelo sinal vital precisa do parâmetro e do limiar.',
  'descricao-curta': 'A descrição tem ao menos 3 letras.',
  'unidade-obrigatoria': 'Informe a unidade de prescrição.',
  'via-obrigatoria': 'Informe ao menos uma via.',
  'via-repetida': 'Via repetida.',
  'justificativa-curta': 'Justifique o item não padronizado (ao menos 10 letras).',
  'bloqueio-sem-motivo': 'Informe o motivo do bloqueio.',
  'local-sem-setor': 'A sala só vale dentro de um setor.',
  'restrito-sem-setor': 'O uso restrito precisa do setor.',
  'quantidade-invalida': 'A quantidade padrão é maior que zero.',
  'dose-invalida': 'A dose padrão é maior que zero.',
  'termo-invalido': 'O termo tem de 2 a 100 letras.',
  'termo-repetido': 'O termo repete o nome do item ou outro sinônimo.',
  'conflito-consigo': 'O item não conflita consigo mesmo.',
  'conflito-repetido': 'Este par já está cadastrado.',
  'motivo-obrigatorio': 'Informe o motivo do conflito impeditivo.',
  'regra-repetida': 'Já existe uma regra do item para este setor.',
  'frequencia-repetida': 'A frequência já está aceita para o item.',
};
