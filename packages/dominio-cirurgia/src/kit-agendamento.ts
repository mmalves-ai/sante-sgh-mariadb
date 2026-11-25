// Kit padrão no agendamento cirúrgico (F3.6, 05-SUP linha 13): ao marcar a cirurgia, o kit padrão de cada
// procedimento agendado é sugerido e, aceito, entra na lista de materiais previstos do agendamento (uma linha de
// natureza "kit" por kit e procedimento). Regras puras: em que situação a lista ainda se mexe, o que entra (o kit que
// já está na lista não entra de novo) e as recusas da escolha. A porta reconfere tudo no banco, sob a trava do
// agendamento, e nunca apaga: a linha retirada fica com a marca de exclusão.

/** Situações do agendamento em que a lista de materiais previstos ainda pode mudar (antes de a cirurgia começar). */
export const SITUACOES_LISTA_MATERIAL_ABERTA = [
  'solicitado',
  'em_analise',
  'agendado',
  'confirmado',
  'no_bloco',
] as const;

/** O kit padrão de um procedimento do agendamento (vínculo marcado como padrão, kit ativo do estabelecimento). */
export interface KitPadraoDoAgendamento {
  /** A linha do procedimento no agendamento. */
  readonly procedimentoAgendamento: number;
  readonly kit: number;
  readonly quantidadeKits: number;
}

/** Uma linha vigente (sem marca de exclusão) da lista de materiais do agendamento. */
export interface MaterialVigenteAgendamento {
  readonly kit: number | null;
  readonly procedimentoAgendamento: number | null;
}

export interface LinhaKitAgendamento {
  readonly procedimentoAgendamento: number;
  readonly kit: number;
  readonly quantidade: number;
}

export interface ProblemaKitAgendamento {
  readonly campo: string;
  readonly mensagem: string;
}

export const chaveKitAgendamento = (x: { kit: number | null; procedimentoAgendamento: number | null }) =>
  `${x.procedimentoAgendamento ?? 0}:${x.kit ?? 0}`;

export function listaMaterialAberta(situacao: string): boolean {
  return (SITUACOES_LISTA_MATERIAL_ABERTA as readonly string[]).includes(situacao);
}

/** Se o kit padrão já está na lista vigente do agendamento (mesmo kit, mesmo procedimento). */
export function kitJaNaLista(
  padrao: Pick<KitPadraoDoAgendamento, 'kit' | 'procedimentoAgendamento'>,
  materiais: readonly MaterialVigenteAgendamento[],
): boolean {
  const chave = chaveKitAgendamento(padrao);
  return materiais.some((m) => m.kit !== null && chaveKitAgendamento(m) === chave);
}

/**
 * As linhas que entram na lista: os kits padrão escolhidos (todos, quando a escolha não vem) que ainda não estão
 * nela, com a quantidade de kits do vínculo. A ordem é a dos padrões.
 */
export function linhasKitAgendamento(
  padroes: readonly KitPadraoDoAgendamento[],
  materiais: readonly MaterialVigenteAgendamento[],
  escolhidos?: readonly { kit: number; procedimentoAgendamento: number }[],
): LinhaKitAgendamento[] {
  const querem = escolhidos ? new Set(escolhidos.map(chaveKitAgendamento)) : null;
  const vistos = new Set<string>();
  const saida: LinhaKitAgendamento[] = [];
  for (const p of padroes) {
    const chave = chaveKitAgendamento(p);
    if (vistos.has(chave) || (querem && !querem.has(chave)) || kitJaNaLista(p, materiais)) continue;
    vistos.add(chave);
    saida.push({
      procedimentoAgendamento: p.procedimentoAgendamento,
      kit: p.kit,
      quantidade: p.quantidadeKits > 0 ? p.quantidadeKits : 1,
    });
  }
  return saida;
}

/**
 * As recusas da escolha, todas juntas e antes de qualquer escrita: a lista fechada pela situação, nenhum kit
 * escolhido, kit repetido na escolha e kit que não é o padrão de um procedimento do agendamento.
 */
export function conferirKitsAgendamento(
  situacao: string,
  padroes: readonly KitPadraoDoAgendamento[],
  escolhidos: readonly { kit: number; procedimentoAgendamento: number }[],
): ProblemaKitAgendamento[] {
  const problemas: ProblemaKitAgendamento[] = [];
  if (!listaMaterialAberta(situacao))
    problemas.push({
      campo: 'situacao',
      mensagem:
        'A lista de materiais desta cirurgia está fechada: a cirurgia já começou, terminou ou foi cancelada.',
    });
  if (!escolhidos.length) problemas.push({ campo: 'kits', mensagem: 'Escolha ao menos um kit padrão.' });
  const validos = new Set(padroes.map(chaveKitAgendamento));
  const vistos = new Set<string>();
  for (const [i, e] of escolhidos.entries()) {
    const chave = chaveKitAgendamento(e);
    if (vistos.has(chave))
      problemas.push({ campo: `kits.${i}`, mensagem: `O kit da linha ${i + 1} está repetido na escolha.` });
    else if (!validos.has(chave))
      problemas.push({
        campo: `kits.${i}`,
        mensagem: `O kit da linha ${i + 1} não é o padrão de um procedimento desta cirurgia.`,
      });
    vistos.add(chave);
  }
  return problemas;
}

/** A linha da lista que se quer retirar, como está no banco. */
export interface LinhaRetiradaMaterial {
  readonly natureza: string;
  /** A solicitação de OPME a que a linha está ligada (material especial ou implante), quando houver. */
  readonly solicitacaoOpme: number | null;
  readonly implantePermanente: boolean;
}

/** Se a linha sai pela retirada do kit: só a linha de kit, sem solicitação de OPME e sem implante. */
export function materialRetiravelPeloKit(linha: LinhaRetiradaMaterial): boolean {
  return linha.natureza === 'kit' && linha.solicitacaoOpme === null && !linha.implantePermanente;
}

/**
 * A recusa de retirar uma linha da lista (a linha some da lista, mas fica no banco com a marca de exclusão). Por este
 * caminho só sai a linha de kit: material especial ou implante (OPME), instrumental e os demais materiais têm regras e
 * rastreabilidade próprias e não saem pela retirada do kit.
 */
export function conferirRetiradaMaterial(
  situacao: string,
  linha: LinhaRetiradaMaterial,
): ProblemaKitAgendamento[] {
  const problemas: ProblemaKitAgendamento[] = [];
  if (!listaMaterialAberta(situacao))
    problemas.push({
      campo: 'situacao',
      mensagem:
        'A lista de materiais desta cirurgia está fechada: a cirurgia já começou, terminou ou foi cancelada.',
    });
  if (!materialRetiravelPeloKit(linha))
    problemas.push({
      campo: 'natureza',
      mensagem:
        'Só a linha de kit sai por aqui: material especial, implante, instrumental e os demais materiais seguem o fluxo próprio.',
    });
  return problemas;
}
