// Regras puras da manutenção da estrutura (F3.1, 02-CAD linhas 26 e 27): dados do estabelecimento, unidades
// assistenciais, setores (tipo, superior sem ciclo, responsável com vigência, regras de agendamento e de lançamento
// na conta) e ramais do setor. Sem banco e sem HTTP: devolvem códigos de erro, todos de uma vez, para a tela marcar
// cada campo na hora. Nada aqui apaga: inativar é sempre com data e o histórico fica.

const SO_DIGITOS = /^\d+$/;
const CODIGO = /^[A-Za-z0-9._-]{1,30}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** CNPJ com os dois dígitos verificadores conferidos (14 dígitos, sem máscara; todos iguais recusado). */
export function cnpjConfere(cnpj: string): boolean {
  if (!/^\d{14}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false;
  const dv = (base: string): number => {
    let soma = 0;
    let peso = base.length - 7;
    for (const c of base) {
      soma += Number(c) * peso;
      peso = peso === 2 ? 9 : peso - 1;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(cnpj.slice(0, 12));
  const d2 = dv(cnpj.slice(0, 12) + String(d1));
  return cnpj.endsWith(`${d1}${d2}`);
}

// ── Estabelecimento ──

export interface DadosEstabelecimento {
  readonly razaoSocial: string;
  readonly nomeFantasia: string;
  readonly cnpj: string | null;
  readonly cnes: string | null;
  readonly cep: string | null;
  readonly email: string | null;
  readonly inicioAtividade: string | null;
  readonly fimAtividade: string | null;
}

export function errosEstabelecimento(d: DadosEstabelecimento): string[] {
  const e: string[] = [];
  if (d.razaoSocial.trim().length < 3) e.push('razao-social-vazia');
  if (d.nomeFantasia.trim().length < 2) e.push('nome-fantasia-vazio');
  if (d.cnpj !== null && !cnpjConfere(d.cnpj)) e.push('cnpj-invalido');
  if (d.cnes !== null && !/^\d{7}$/.test(d.cnes)) e.push('cnes-invalido');
  if (d.cep !== null && !/^\d{8}$/.test(d.cep)) e.push('cep-invalido');
  if (d.email !== null && !EMAIL.test(d.email)) e.push('email-invalido');
  if (d.inicioAtividade && d.fimAtividade && d.fimAtividade < d.inicioAtividade)
    e.push('atividade-invertida');
  return e;
}

// ── Unidade assistencial ──

export const TIPOS_UNIDADE = [
  'ambulatorio',
  'pronto_atendimento',
  'internacao',
  'diagnostico',
  'centro_cirurgico',
  'hospital_dia',
  'atencao_domiciliar',
  'outra',
] as const;
export type TipoUnidade = (typeof TIPOS_UNIDADE)[number];

export interface DadosUnidade {
  readonly codigo: string;
  readonly nome: string;
  readonly tipo: string;
  readonly cnes: string | null;
  readonly cnpj: string | null;
  readonly cep: string | null;
}

export function errosUnidade(d: DadosUnidade): string[] {
  const e: string[] = [];
  if (!CODIGO.test(d.codigo)) e.push('codigo-invalido');
  if (d.nome.trim().length < 2) e.push('nome-vazio');
  if (!(TIPOS_UNIDADE as readonly string[]).includes(d.tipo)) e.push('tipo-unidade-invalido');
  if (d.cnes !== null && !/^\d{7}$/.test(d.cnes)) e.push('cnes-invalido');
  if (d.cnpj !== null && !cnpjConfere(d.cnpj)) e.push('cnpj-invalido');
  if (d.cep !== null && !/^\d{8}$/.test(d.cep)) e.push('cep-invalido');
  return e;
}

// ── Setor ──

export const TIPOS_SETOR = [
  'assistencial',
  'apoio_diagnostico',
  'apoio_tecnico',
  'administrativo',
  'logistico',
] as const;
export type TipoSetor = (typeof TIPOS_SETOR)[number];

export interface DadosSetor {
  readonly codigo: string;
  readonly nome: string;
  readonly sigla: string | null;
  readonly tipo: string;
  readonly centroCusto: number | null;
  readonly responsavel: number | null;
  readonly responsavelInicio: string | null;
  readonly responsavelFim: string | null;
  readonly aceitaLancamentoConta: boolean;
  readonly producaoFaturada: boolean;
  readonly podeSolicitarExames: boolean;
  readonly exigeProfissionalAgendamento: boolean;
  readonly exigeRecursoAgendamento: boolean;
  readonly siglaAgendamento: string | null;
}

/**
 * Erros do setor. Melhor prática de custo: setor que lança na conta ou tem produção faturada precisa de centro de
 * custo (sem ele a receita não é apurada). O responsável tem vigência; o agendamento por setor precisa de sigla.
 */
export function errosSetor(d: DadosSetor): string[] {
  const e: string[] = [];
  if (!CODIGO.test(d.codigo)) e.push('codigo-invalido');
  if (d.nome.trim().length < 2) e.push('nome-vazio');
  if (d.sigla !== null && d.sigla.length > 10) e.push('sigla-longa');
  if (!(TIPOS_SETOR as readonly string[]).includes(d.tipo)) e.push('tipo-setor-invalido');
  if ((d.aceitaLancamentoConta || d.producaoFaturada) && d.centroCusto === null)
    e.push('lancamento-sem-centro-custo');
  if (d.responsavel !== null && d.responsavelInicio === null) e.push('responsavel-sem-inicio');
  if (d.responsavel === null && (d.responsavelInicio !== null || d.responsavelFim !== null))
    e.push('vigencia-sem-responsavel');
  if (d.responsavelInicio && d.responsavelFim && d.responsavelFim < d.responsavelInicio)
    e.push('responsavel-vigencia-invertida');
  if ((d.exigeProfissionalAgendamento || d.exigeRecursoAgendamento) && !d.siglaAgendamento)
    e.push('agendamento-sem-sigla');
  if (d.podeSolicitarExames && d.tipo === 'logistico') e.push('logistico-solicita-exame');
  return e;
}

/**
 * Verdadeiro quando ligar `setor` a `superior` fecha um ciclo na árvore (o superior é o próprio setor ou um
 * descendente dele). `superiores` dá o superior atual de cada setor do estabelecimento.
 */
export function formaCiclo(
  setor: number | null,
  superior: number | null,
  superiores: ReadonlyMap<number, number | null>,
): boolean {
  if (superior === null || setor === null) return false;
  const vistos = new Set<number>();
  let atual: number | null = superior;
  while (atual !== null) {
    if (atual === setor) return true;
    if (vistos.has(atual)) return true;
    vistos.add(atual);
    atual = superiores.get(atual) ?? null;
  }
  return false;
}

/**
 * Inativar o setor só sem uso vivo: setores filhos ativos (ficariam órfãos na árvore), leitos ativos nas unidades de
 * internação do setor, pacientes ocupando leito nele e atendimentos abertos no setor. Um erro por tipo de vínculo,
 * para a tela dizer o que resolver antes. A inativação vale no dia em que é gravada: data futura é recusada (o
 * estado "inativo" e a data não podem se contradizer); data antes da criação também. A linha e o histórico ficam.
 */
export function errosInativarSetor(i: {
  readonly filhosAtivos: number;
  readonly leitosAtivos: number;
  readonly pacientesNoLeito: number;
  readonly atendimentosAbertos: number;
  readonly data: string;
  readonly hoje: string;
  readonly criadoEm: string;
}): string[] {
  const e: string[] = [];
  if (i.filhosAtivos > 0) e.push('setor-com-filhos-ativos');
  if (i.leitosAtivos > 0) e.push('setor-com-leitos-ativos');
  if (i.pacientesNoLeito > 0) e.push('setor-com-pacientes-internados');
  if (i.atendimentosAbertos > 0) e.push('setor-com-atendimentos-abertos');
  if (i.data > i.hoje) e.push('inativacao-futura');
  if (i.data < i.criadoEm) e.push('inativacao-antes-da-criacao');
  return e;
}

// ── Responsável pelo setor (histórico com vigência) ──

export interface ResponsavelVigente {
  readonly id: number;
  readonly profissional: number;
  readonly inicio: string;
  readonly fim: string | null;
}

/** O dia anterior a uma data ISO (AAAA-MM-DD), em UTC para não depender do fuso. */
export function vespera(dia: string): string {
  const d = new Date(`${dia}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function mesmoPeriodo(
  vigente: ResponsavelVigente | null,
  profissional: number | null,
  inicio: string,
): boolean {
  return (
    vigente !== null &&
    vigente.profissional === profissional &&
    (vigente.fim === null || vigente.fim >= inicio || inicio <= vigente.inicio)
  );
}

export type PlanoResponsavel =
  | { readonly tipo: 'nada' }
  | { readonly tipo: 'ajustar-fim'; readonly id: number; readonly fim: string | null }
  | {
      readonly tipo: 'trocar';
      /** O período em aberto a encerrar na véspera do novo início (nulo quando não havia responsável). */
      readonly encerrar: { readonly id: number; readonly fim: string } | null;
      /** O novo período (nulo quando o setor fica sem responsável a partir de agora). */
      readonly incluir: {
        readonly profissional: number;
        readonly inicio: string;
        readonly fim: string | null;
      } | null;
    };

/**
 * O que gravar no histórico de responsáveis ao salvar o setor. O mesmo profissional só ajusta o fim do período
 * vigente; outro profissional encerra o anterior na véspera do novo início e abre um período novo (nada é
 * sobrescrito: quem respondeu pelo setor em cada período fica consultável). Sem responsável e sem período aberto,
 * nada a fazer. `hoje` encerra o período quando o responsável é retirado sem substituto.
 */
export function planoResponsavel(
  vigente: ResponsavelVigente | null,
  novo: { profissional: number | null; inicio: string | null; fim: string | null },
  hoje: string,
): PlanoResponsavel {
  if (novo.profissional === null) {
    // Sem responsável: encerra hoje o período que ainda vale; o que já terminou fica como está.
    if (vigente === null || (vigente.fim !== null && vigente.fim <= hoje)) return { tipo: 'nada' };
    const fim = vigente.inicio > hoje ? vespera(vigente.inicio) : hoje;
    return { tipo: 'trocar', encerrar: { id: vigente.id, fim }, incluir: null };
  }
  const inicio = novo.inicio ?? hoje;
  // O mesmo profissional com o período ainda valendo no início pedido: só o fim muda. Período já terminado: abre outro.
  if (mesmoPeriodo(vigente, novo.profissional, inicio)) {
    return vigente!.fim === novo.fim
      ? { tipo: 'nada' }
      : { tipo: 'ajustar-fim', id: vigente!.id, fim: novo.fim };
  }
  return {
    tipo: 'trocar',
    // O anterior só é encerrado se ainda valeria no novo início (nunca se estende um período já terminado).
    encerrar:
      vigente === null || (vigente.fim !== null && vigente.fim < inicio)
        ? null
        : { id: vigente.id, fim: vespera(inicio) },
    incluir: { profissional: novo.profissional, inicio, fim: novo.fim },
  };
}

/** Erros da troca de responsável: o novo período começa depois do início do anterior (e depois do fim dele, quando
 *  já terminou), para os períodos do histórico não se cruzarem. */
export function errosTrocaResponsavel(
  vigente: ResponsavelVigente | null,
  novo: { profissional: number | null; inicio: string | null },
): string[] {
  if (vigente === null || novo.profissional === null || novo.inicio === null) return [];
  if (mesmoPeriodo(vigente, novo.profissional, novo.inicio)) return [];
  const limite = vigente.fim !== null && vigente.fim < novo.inicio ? vigente.fim : vigente.inicio;
  return novo.inicio <= limite ? ['responsavel-inicio-antes-do-anterior'] : [];
}

// ── Ramais do setor ──

export interface RamalSetor {
  readonly ramal: string;
  readonly contato: string | null;
  readonly principal: boolean;
  readonly responsavel: boolean;
  readonly telefoneExterno: string | null;
}

/** Ramais com 2 a 10 dígitos, sem repetir no setor, no máximo um principal e um do responsável; telefone externo
 *  com DDD (10 ou 11 dígitos). */
export function errosRamais(ramais: readonly RamalSetor[]): string[] {
  const e = new Set<string>();
  const vistos = new Set<string>();
  for (const r of ramais) {
    if (!SO_DIGITOS.test(r.ramal) || r.ramal.length < 2 || r.ramal.length > 10) e.add('ramal-invalido');
    if (vistos.has(r.ramal)) e.add('ramal-repetido');
    vistos.add(r.ramal);
    if (r.telefoneExterno !== null && !/^\d{10,11}$/.test(r.telefoneExterno)) e.add('telefone-invalido');
    if (r.contato !== null && r.contato.length > 60) e.add('contato-longo');
  }
  if (ramais.filter((r) => r.principal).length > 1) e.add('mais-de-um-principal');
  if (ramais.filter((r) => r.responsavel).length > 1) e.add('mais-de-um-responsavel');
  return [...e];
}

/** O ramal principal do setor (o marcado ou, sem marca, o primeiro), espelhado em `ramal_principal` para as listas. */
export function ramalPrincipal(ramais: readonly RamalSetor[]): string | null {
  return (ramais.find((r) => r.principal) ?? ramais[0])?.ramal ?? null;
}
