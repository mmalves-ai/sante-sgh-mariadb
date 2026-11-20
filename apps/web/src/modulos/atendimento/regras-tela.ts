// Regras de tela do atendimento (M20) sem estado, testadas à parte: o que a abertura preenche do agendamento, o tipo
// inicial da abertura, quando o agendamento do dia oferece "Abrir atendimento", o PDF como arquivo do navegador e a
// permissão do item do menu igual à da rota de destino. Nenhuma regra de negócio: o servidor decide e confere.
import type { ApoioAtendimento, AtendimentoDetalhe, Carater, MarcacaoAbertura } from '@sgh/contratos';

/** Os campos da abertura que o agendamento preenche (texto, como os seletores da tela). */
export interface PreenchimentoAbertura {
  readonly convenio: string;
  readonly especialidade: string;
  readonly profissional: string;
  readonly unidade: string;
  readonly centroCusto: string;
  readonly procedimento: string;
  readonly retorno: boolean;
}

const texto = (n: number, existe: boolean) => (n > 0 && existe ? String(n) : '');

/**
 * O agendamento preenche a abertura: o convênio aceito, a especialidade, o vínculo do profissional da agenda (pelo
 * registro no conselho, o que atende a especialidade primeiro), a unidade, o centro de custo e o procedimento. O que
 * não existe no apoio fica vazio para a pessoa escolher.
 */
export function preenchimentoDaMarcacao(m: MarcacaoAbertura, apoio: ApoioAtendimento): PreenchimentoAbertura {
  const doCrm = apoio.profissionais.filter((p) => m.crm > 0 && p.crm === m.crm);
  const prof = doCrm.find((p) => p.especialidades.includes(m.especialidade)) ?? doCrm[0];
  return {
    convenio: texto(
      m.convenio,
      apoio.convenios.some((c) => c.codigo === m.convenio && c.aceita),
    ),
    especialidade: texto(
      m.especialidade,
      apoio.especialidades.some((e) => e.codigo === m.especialidade),
    ),
    profissional: prof ? String(prof.id) : '',
    unidade: texto(
      m.unidade,
      apoio.unidades.some((u) => u.codigo === m.unidade),
    ),
    centroCusto: texto(
      m.centroCusto,
      apoio.centrosCusto.some((c) => c.codigo === m.centroCusto),
    ),
    procedimento: m.procedimento > 0 ? String(m.procedimento) : '',
    retorno: m.retorno,
  };
}

/**
 * O tipo inicial da abertura: da senha do guichê, nenhum (qualquer recepção chama senha: ambulatório, central de
 * exames, pronto atendimento) e a pessoa escolhe; do agendamento ou direta, a consulta.
 */
export function tipoInicialDaAbertura(o: { senha: number | null }): '' | 'consulta' {
  return o.senha ? '' : 'consulta';
}

/** O agendamento do dia oferece "Abrir atendimento" (só hoje, sem ficha ainda, com o paciente do cadastro). */
export function ofereceAbertura(
  m: { data: string; estado: string; idPaciente: number | null },
  hoje: string,
): boolean {
  return m.data === hoje && ['marcada', 'confirmada', 'chegou'].includes(m.estado) && m.idPaciente !== null;
}

/** O PDF do impresso (base64) como arquivo do navegador: a aba nova abre por endereço blob:, nunca data:. */
export function blobDoPdf(base64: string): Blob {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: 'application/pdf' });
}

/** Itens do menu cuja permissão difere da exigida pela rota de destino (cairiam em "sem permissão"). */
export function itensComPermissaoDiferente(
  itens: readonly { id: string; rota: string | null; permissao: string | null }[],
  permissaoDaRota: (caminho: string) => string | null | undefined,
): string[] {
  return itens
    .filter((i) => i.rota && i.permissao)
    .filter((i) => {
      const exigida = permissaoDaRota((i.rota as string).split('?')[0] as string);
      return exigida !== undefined && exigida !== null && exigida !== i.permissao;
    })
    .map((i) => i.id);
}

// ── W1-05: correção da ficha aberta ──────────────────────────────────────────────────────────────

/**
 * Os campos da tela de correção (texto, como os seletores). CID, solicitante e observação vêm com o valor gravado;
 * `null` (ou observação vazia) no CID secundário, no solicitante e na observação retira o valor gravado.
 */
export interface CamposCorrecao {
  readonly convenio: string;
  readonly especialidade: string;
  readonly profissional: string;
  readonly procedimento: string;
  readonly carater: Carater | '';
  readonly cidPrincipal: number | null;
  readonly cidSecundario: number | null;
  readonly solicitante: number | null;
  readonly observacao: string;
}

/** O vínculo do profissional da ficha (pelo registro no conselho, o que atende a especialidade primeiro). */
export function vinculoDaFicha(f: AtendimentoDetalhe, apoio: ApoioAtendimento): string {
  const doCrm = apoio.profissionais.filter((p) => f.profissional.crm > 0 && p.crm === f.profissional.crm);
  const prof = doCrm.find((p) => p.especialidades.includes(f.especialidade.codigo)) ?? doCrm[0];
  return prof ? String(prof.id) : '';
}

/** Os campos da correção preenchidos com a ficha lida (a pessoa muda só o que está errado). */
export function camposDaFicha(f: AtendimentoDetalhe, apoio: ApoioAtendimento): CamposCorrecao {
  return {
    convenio: String(f.convenio.codigo),
    especialidade: f.especialidade.codigo > 0 ? String(f.especialidade.codigo) : '',
    profissional: vinculoDaFicha(f, apoio),
    procedimento: f.procedimento.codigo > 0 ? String(f.procedimento.codigo) : '',
    carater: f.carater ?? '',
    cidPrincipal: f.cidPrincipal?.id ?? null,
    cidSecundario: f.cidSecundario?.id ?? null,
    solicitante: f.solicitante?.id ?? null,
    observacao: f.observacaoFicha ?? '',
  };
}

/**
 * A entrada da correção: só o que mudou em relação à ficha lida (o servidor recusa "nada a alterar"), com a
 * justificativa e o carimbo lido. `null` quando nada mudou. Retirar o CID secundário, o solicitante ou a observação
 * gravados envia `null` (o contrato limpa); o CID principal só se troca.
 */
export function entradaDaCorrecao(
  antes: CamposCorrecao,
  agora: CamposCorrecao,
  justificativa: string,
  versao: string,
): Record<string, unknown> | null {
  const e: Record<string, unknown> = {};
  const num = (k: 'convenio' | 'especialidade' | 'profissional' | 'procedimento') => {
    if (agora[k] !== '' && agora[k] !== antes[k]) e[k] = Number(agora[k]);
  };
  num('convenio');
  num('especialidade');
  num('profissional');
  num('procedimento');
  if (agora.carater !== '' && agora.carater !== antes.carater) e.carater = agora.carater;
  if (agora.cidPrincipal !== null && agora.cidPrincipal !== antes.cidPrincipal)
    e.cidPrincipal = agora.cidPrincipal;
  if (agora.cidSecundario !== antes.cidSecundario) e.cidSecundario = agora.cidSecundario;
  if (agora.solicitante !== antes.solicitante) e.solicitante = agora.solicitante;
  const obs = agora.observacao.trim();
  if (obs !== antes.observacao.trim()) e.observacao = obs === '' ? null : obs;
  if (Object.keys(e).length === 0) return null;
  return { ...e, justificativa: justificativa.trim(), versao };
}

/** A data de hoje (AAAA-MM-DD) no fuso local, limite da correção da data do procedimento extra. */
export function hojeIso(agora = new Date()): string {
  const d = new Date(agora.getTime() - agora.getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 10);
}

/** Os dependentes de uma recusa (409 com `dependentes`: quantos e quais), lidos com tolerância do Problem Details. */
export function dependentesDoErro(
  problema: unknown,
): { rotulo: string; quantidade: number; amostra: string[] }[] {
  const lista = (problema as { dependentes?: unknown } | null)?.dependentes;
  if (!Array.isArray(lista)) return [];
  return lista
    .filter((d): d is Record<string, unknown> => typeof d === 'object' && d !== null)
    .map((d) => ({
      rotulo: typeof d.rotulo === 'string' ? d.rotulo : typeof d.tabela === 'string' ? d.tabela : '',
      quantidade: typeof d.quantidade === 'number' ? d.quantidade : 0,
      amostra: Array.isArray(d.amostra) ? d.amostra.map(String).slice(0, 5) : [],
    }))
    .filter((d) => d.rotulo !== '' && d.quantidade > 0);
}
