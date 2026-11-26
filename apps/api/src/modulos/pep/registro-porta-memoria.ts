// Porta dos registros clínicos em MEMÓRIA (M22): a sessão sintética de dev/ci (E2E) registra nos modelos SINTÉTICOS
// (DFM fictício convertido pelo parser do M09: EVOLUÇÃO MÉDICA com texto formatado; ENFERMAGEM com Sim/Não, lista
// marcada, quantidade com unidade, data habilitada pela resposta, hora e texto com MANTERHIST) dos pacientes
// sintéticos do cadastro (1001 e 1003). O que se grava é o que o adaptador gravaria (as linhas, o RTF e o XML do
// gravador do domínio), guardado em memória por estabelecimento; nada vai à cópia. Marca "SINTETICO".
import { createHash } from 'node:crypto';
import { type ContextoOperacao, ErroOperacao } from '@sgh/nucleo';
import {
  type AtendimentoLido,
  type CabecalhoDocumentoLido,
  type CabecalhoRegistroLido,
  type DefinicaoFormularioLida,
  type GravacaoEvolucao,
  type GravacaoRascunho,
  type LinhaGravacao,
  type LinhaRespostaLida,
  type ModeloDoRegistro,
  type ProfissionalDoRegistro,
  type RascunhoLido,
  loginDaOperacao,
} from './tipos-pep.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import type { ContextoRegistro, PortaRegistro, ProvaLida } from './registro-porta.js';

/** Contexto da gravação em memória: o mesmo da operação do núcleo. */
type CtxMemoria = ContextoOperacao;

const M = 'SINTETICO';

interface PerguntaSintetica {
  readonly ordem: string;
  readonly classe: string;
  readonly componente: string;
  readonly titulo: string;
  readonly tipo: string;
  readonly unidade?: string;
  readonly opcoes?: readonly string[];
  readonly manterHist?: number;
  readonly obrigatorio?: boolean;
  readonly habilitar?: string;
  readonly largura?: number;
}

/** Modelos sintéticos (os mesmos códigos dos dois primeiros da lista dos 10 de maior uso). */
const MODELOS: Readonly<
  Record<number, { codigo: string; nome: string; tipo: string; perguntas: readonly PerguntaSintetica[] }>
> = {
  61: {
    codigo: 'EVAM',
    nome: `EVOLUÇÃO MÉDICA ${M}`,
    tipo: 'Evolução',
    perguntas: [
      {
        ordem: '01',
        classe: 'TGroupBoxPep',
        componente: 'cmp601',
        titulo: `EVOLUÇÃO MÉDICA ${M}`,
        tipo: '1',
      },
      {
        ordem: '0101',
        classe: 'TfRespTexto',
        componente: 'cmp602',
        titulo: 'Quadro clínico',
        tipo: '5',
        manterHist: 3,
        obrigatorio: true,
      },
      { ordem: '0102', classe: 'TfRespTexto', componente: 'cmp603', titulo: 'Exame físico', tipo: '5' },
      {
        ordem: '0103',
        classe: 'TfRespTexto',
        componente: 'cmp604',
        titulo: 'Conduta',
        tipo: '5',
        manterHist: 1,
      },
    ],
  },
  62: {
    // Código de um modelo liberado por padrão (o ENF091 real fica fora da liberação: conferência abaixo da meta).
    codigo: 'M10',
    nome: `RELATÓRIO DE ENFERMAGEM ${M}`,
    tipo: 'Evolução',
    perguntas: [
      {
        ordem: '01',
        classe: 'TGroupBoxPep',
        componente: 'cmp701',
        titulo: `RELATÓRIO DE ENFERMAGEM ${M}`,
        tipo: '1',
      },
      {
        ordem: '0101',
        classe: 'TfRespComboBox',
        componente: 'cmp702',
        titulo: 'Acesso venoso',
        tipo: '4',
        opcoes: ['', 'Não', 'Sim'],
        largura: 350,
      },
      {
        ordem: '0102',
        classe: 'TfRespData',
        componente: 'cmp703',
        titulo: 'Data da punção',
        tipo: '2',
        habilitar: 'if (cmp702ItemIndex = 1) then result := false else result := true;',
        largura: 350,
      },
      {
        ordem: '0103',
        classe: 'TfRespHora',
        componente: 'cmp704',
        titulo: 'Hora da avaliação',
        tipo: '3',
        largura: 160,
      },
      {
        ordem: '0104',
        classe: 'TfRespCheckListBox',
        componente: 'cmp705',
        titulo: 'Dieta',
        tipo: '12',
        opcoes: ['Zero', 'Oral', 'Enteral'],
        manterHist: 1,
      },
      {
        ordem: '0105',
        classe: 'TfRespEditUnidade',
        componente: 'cmp706',
        titulo: 'Frequência cardíaca',
        tipo: '7',
        unidade: 'bpm',
        largura: 350,
      },
      { ordem: '0106', classe: 'TfRespTexto', componente: 'cmp707', titulo: 'Observações', tipo: '5' },
    ],
  },
  // M23 (regra 10): os modelos do pedido e da resposta de parecer (os códigos do legado; conteúdo sintético).
  63: {
    codigo: 'MED09',
    nome: `SOLICITAÇÃO DE PARECER ${M}`,
    tipo: 'Parecer',
    perguntas: [
      {
        ordem: '01',
        classe: 'TGroupBoxPep',
        componente: 'cmp801',
        titulo: `SOLICITAÇÃO DE PARECER ${M}`,
        tipo: '1',
      },
      {
        ordem: '0101',
        classe: 'TfRespTexto',
        componente: 'cmp802',
        titulo: 'Motivo do parecer',
        tipo: '5',
        obrigatorio: true,
      },
    ],
  },
  64: {
    codigo: 'MED10',
    nome: `RESPOSTA DE PARECER ${M}`,
    tipo: 'Parecer',
    perguntas: [
      {
        ordem: '01',
        classe: 'TGroupBoxPep',
        componente: 'cmp901',
        titulo: `RESPOSTA DE PARECER ${M}`,
        tipo: '1',
      },
      {
        ordem: '0101',
        classe: 'TfRespTexto',
        componente: 'cmp902',
        titulo: 'Parecer',
        tipo: '5',
        obrigatorio: true,
      },
    ],
  },
  // C1-104 (D-ALE-2): modelo com o componente de alergia, para o E2E registrar a alergia de dentro do formulário.
  65: {
    codigo: 'ALERG',
    nome: `ANAMNESE COM ALERGIAS ${M}`,
    tipo: 'Evolução',
    perguntas: [
      {
        ordem: '01',
        classe: 'TGroupBoxPep',
        componente: 'cmp951',
        titulo: `ANAMNESE COM ALERGIAS ${M}`,
        tipo: '1',
      },
      { ordem: '0101', classe: 'TfRespTexto', componente: 'cmp952', titulo: 'História clínica', tipo: '5' },
      { ordem: '0102', classe: 'TfRespAlergia', componente: 'cmp953', titulo: 'Alergias', tipo: '19' },
    ],
  },
};

function dfm(p: PerguntaSintetica, idResposta: number, ids: readonly number[]): string {
  const lista = (xs: readonly string[]) => xs.map((x) => `      '${x.replace(/'/g, "''")}'`).join('\r\n');
  const l = [
    `inherited ${p.componente}: ${p.classe}`,
    '  Left = 5',
    `  Top = ${Number(p.ordem.slice(-2)) * 60}`,
    `  Width = ${p.largura ?? 744}`,
    `  Height = ${p.classe === 'TfRespTexto' ? 110 : 40}`,
    `  ${p.classe === 'TGroupBoxPep' ? 'Caption' : 'Description'} = '${p.titulo}'`,
    `  Ordem = '${p.ordem}'`,
    `  Id_resposta = ${idResposta}`,
    `  CampoObrigatorio = ${p.obrigatorio ? 'True' : 'False'}`,
    `  Fonte = 'name=Arial'#13#10'style=${p.classe === 'TGroupBoxPep' ? '[fsBold]' : ''}'#13#10'size=8'#13#10`,
  ];
  if (p.habilitar) l.push(`  ExpressionEnabled = '${p.habilitar.replace(/'/g, "''")}'`);
  if (p.opcoes && p.classe === 'TfRespComboBox')
    l.push(
      '  inherited cbxId_Resposta: TComboBox',
      '    Items.Strings = (',
      lista(['0', ...ids.map(String)]) + ')',
      '  end',
      '  inherited cbxResp: TValidadeComboBox',
      '    Items.Strings = (',
      lista(p.opcoes) + ')',
      '  end',
    );
  if (p.opcoes && p.classe === 'TfRespCheckListBox')
    l.push('  inherited clbResp: TCheckListBox', '    Items.Strings = (', lista(p.opcoes) + ')', '  end');
  l.push('end');
  return l.join('\r\n');
}

function definicaoSintetica(modelo: number): DefinicaoFormularioLida | null {
  const m = MODELOS[modelo];
  if (!m) return null;
  const base = modelo * 100;
  const respostas: DefinicaoFormularioLida['respostas'] = [];
  const componentes: DefinicaoFormularioLida['componentes'] = [];
  m.perguntas.forEach((p, i) => {
    const idPergunta = base + i;
    const idResp = (base + i) * 10;
    const ops = (p.opcoes ?? []).filter((o) => o !== '');
    const ids = p.tipo === '4' ? ops.map(() => idResp) : ops.map((_, j) => idResp + j + 1);
    if (ops.length && p.tipo !== '4')
      ops.forEach((o, j) =>
        respostas.push({
          id: idResp + j + 1,
          idPergunta,
          cod: null,
          ordem: j + 1,
          ativo: true,
          descricao: o,
        }),
      );
    if (!ops.length || p.tipo === '4')
      respostas.push({ id: idResp, idPergunta, cod: null, ordem: 0, ativo: true, descricao: null });
    componentes.push({
      id: base + i,
      idVinculo: base + i,
      classe: p.classe,
      pai: 'jvsBox',
      ordemCriacao: i,
      dfm: dfm(p, ops.length && p.tipo !== '4' ? idResp + 1 : idResp, ids),
    });
  });
  return {
    modelo: { id: modelo, codigo: m.codigo, descricao: m.nome, fase: 2 },
    vinculos: m.perguntas.map((p, i) => ({
      id: base + i,
      idPergunta: base + i,
      ordem: p.ordem,
      obrigatorio: p.obrigatorio ? 'T' : 'F',
      ativo: 'T',
    })),
    perguntas: m.perguntas.map((p, i) => ({
      id: base + i,
      codPergunta: base + i,
      descricao: p.titulo,
      tipo: p.tipo,
      unidade: p.unidade ?? null,
      ativo: 'T',
      manterHist: p.manterHist ?? 0,
    })),
    respostas,
    componentes,
    versoes: [{ versao: 1, componentes: componentes.length }],
    colunasGrade: [],
    bytesDfm: 0,
  };
}

const PACIENTES: Readonly<Record<number, string>> = {
  1001: `JOSÉ DA SILVA ${M}`,
  1003: `CINTHYA GABRIELLA VIANNA ${M}`,
};

/** M23: o registro como o prontuário de uso diário o vê (sem as linhas). */
export interface RegistroOuvido {
  readonly id: number;
  readonly paciente: number;
  readonly atendimento: number;
  readonly modelo: string;
  readonly nomeModelo: string;
  readonly cbo: number;
  readonly dataHoraClinica: string;
  readonly suspenso: boolean;
  readonly hash: string;
  readonly fluxo: GravacaoEvolucao['fluxo'] | null;
  /** M23 (regra 3): o pedido de coassinatura do preceptor. */
  readonly supervisao?: GravacaoEvolucao['supervisao'] | null;
  readonly login: string | null;
}

interface RegistroMemoria {
  readonly id: number;
  readonly paciente: number;
  readonly modelo: number;
  readonly atendimento: number;
  readonly cbo: number;
  readonly dataHoraClinica: string;
  readonly lancadoEm: string;
  readonly linhas: readonly LinhaGravacao[];
  readonly hash: string;
  readonly corrige: number | null;
  /** Eventos do documento feitos numa sessão "como" (a marca do suporte técnico). */
  readonly comoSuporte: ('criado' | 'suspenso')[];
  suspensoEm: string | null;
  justificativaSuspensao: string | null;
  /** Teste: alterado pelo outro sistema depois da gravação; gravado pelo outro sistema (sem prova). */
  alteradoFora?: boolean;
  readonly semProva?: boolean;
}

interface RascunhoMemoria {
  readonly id: number;
  readonly paciente: number;
  readonly modelo: number;
  readonly atendimento: number;
  readonly cbo: number;
  dataHoraClinica: string;
  lancadoEm: string;
  justificativa: string | null;
  linhas: readonly LinhaGravacao[];
  fechado: 'arquivado' | 'excluido' | null;
  /** Criado nesta casa (a marca de origem); o importado não tem, e continua rascunho do autor (ADR 0006). */
  readonly doNovo: boolean;
  readonly anterior: number | null;
  readonly corrige: number | null;
}

function lida(l: LinhaGravacao): LinhaRespostaLida {
  return { ...l, procedimento: null, observacao: null };
}

function agoraLocal(): string {
  // Hora local de São Paulo (o banco do estabelecimento é local; o processo roda em UTC).
  return new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 19);
}

/** CBO sintético do login (a sessão sintética: todo login é profissional; o "SEMCBO" não é). */
export function cboDe(login: string): number | null {
  if (/SEMCBO/i.test(login)) return null;
  let h = 7000;
  for (const c of login) h = (h * 31 + c.charCodeAt(0)) % 9000;
  return 7000 + h;
}

export class PortaRegistroMemoria implements PortaRegistro {
  readonly destino = 'memoria' as const;
  /** A trilha própria da sessão sintética (o executor grava a dele na transação; aqui, o registrador). */
  constructor(private readonly trilha: RegistradorTrilha | null = null) {}

  private async auditar(
    c: ContextoRegistro,
    ctx: CtxMemoria,
    evento: string,
    alvo: { tabela: string; id: number; paciente?: number },
  ): Promise<void> {
    await this.trilha?.registrar({
      evento,
      rede: c.rede,
      hospital: c.hospital,
      usuario: loginDaOperacao(ctx),
      estacao: '',
      correlacao: (ctx.correlacao || evento).slice(0, 64),
      recurso: 'pep.evolucao',
      resultado: 'sucesso',
      tabelaAlvo: alvo.tabela,
      idAlvo: String(alvo.id),
      ...(alvo.paciente ? { paciente: alvo.paciente } : {}),
    });
  }
  private readonly registros = new Map<string, RegistroMemoria[]>();
  /** M23: o prontuário de uso diário (em memória) recebe cada registro gravado (o fluxo do parecer junto). */
  ouvinte: ((hospital: string, r: RegistroOuvido) => void) | null = null;

  /** M23: os registros do estabelecimento (linha do tempo, alergia ligada ao registro, alertas). */
  registrosDe(hospital: string): RegistroOuvido[] {
    return this.regs(hospital).map((r) => ({
      id: r.id,
      paciente: r.paciente,
      atendimento: r.atendimento,
      modelo: MODELOS[r.modelo]?.codigo ?? String(r.modelo),
      nomeModelo: MODELOS[r.modelo]?.nome ?? M,
      cbo: r.cbo,
      dataHoraClinica: r.dataHoraClinica,
      suspenso: r.suspensoEm !== null,
      hash: r.hash,
      fluxo: null,
      login: null,
    }));
  }
  private readonly rascunhos = new Map<string, RascunhoMemoria[]>();
  private proximo = 950_000;

  private regs(h: string) {
    let x = this.registros.get(h);
    if (!x) this.registros.set(h, (x = []));
    return x;
  }
  private rasc(h: string) {
    let x = this.rascunhos.get(h);
    if (!x) this.rascunhos.set(h, (x = []));
    return x;
  }

  private versao(r: RascunhoMemoria): string {
    return createHash('sha256')
      .update(JSON.stringify([r.dataHoraClinica, r.justificativa, r.fechado, r.linhas]))
      .digest('hex')
      .slice(0, 32);
  }

  private lidoDe(r: RascunhoMemoria): RascunhoLido {
    const m = MODELOS[r.modelo];
    return {
      id: r.id,
      paciente: r.paciente,
      pacienteNome: PACIENTES[r.paciente] ?? M,
      modelo: r.modelo,
      modeloCodigo: m?.codigo ?? null,
      modeloNome: m?.nome ?? null,
      idHtAtendimento: r.atendimento * 10,
      atendimento: r.atendimento,
      cbo: r.cbo,
      dataHoraClinica: `${r.dataHoraClinica}:00.000`,
      lancadoEm: r.lancadoEm,
      justificativa: r.justificativa,
      // Perguntas respondidas (as linhas de título de seção não têm valor), como na leitura do banco.
      respostas: new Set(
        r.linhas
          .filter((l) => [l.data, l.hora, l.indice, l.valor, l.alfa, l.texto, l.cid].some((v) => v !== null))
          .map((l) => l.ordem),
      ).size,
      versao: this.versao(r),
      doNovo: r.doNovo,
      corrige: r.corrige,
    };
  }

  /** Teste: um rascunho aberto importado (sem a marca de origem desta casa), ou desta casa. */
  semearRascunhoImportado(
    hospital: string,
    r: { paciente: number; modelo: number; atendimento: number; cbo: number },
    doNovo = false,
    /** O conteúdo de origem: as respostas em edição e o lançamento original (nunca o da carga). */
    origem: { linhas?: readonly LinhaGravacao[]; lancadoEm?: string } = {},
  ): number {
    const id = this.proximo++;
    this.rasc(hospital).push({
      id,
      ...r,
      dataHoraClinica: agoraLocal().slice(0, 16),
      lancadoEm: origem.lancadoEm ?? `${agoraLocal()}.000`,
      justificativa: null,
      linhas: [...(origem.linhas ?? [])],
      fechado: null,
      doNovo,
      anterior: null,
      corrige: null,
    });
    return id;
  }

  /** Teste: o registro alterado pelo outro sistema depois da gravação (a prova deixa de conferir). */
  alterarForaDoNovo(hospital: string, registro: number): void {
    const r = this.regs(hospital).find((x) => x.id === registro);
    if (r) r.alteradoFora = true;
  }

  /** Teste: um registro gravado pelo outro sistema (sem prova). */
  semearRegistroDoOutroSistema(
    hospital: string,
    r: { paciente: number; modelo: number; atendimento: number; cbo: number },
  ): number {
    const id = this.proximo++;
    this.regs(hospital).push({
      id,
      ...r,
      dataHoraClinica: agoraLocal().slice(0, 16),
      lancadoEm: `${agoraLocal()}.000`,
      linhas: [],
      hash: '',
      corrige: null,
      comoSuporte: [],
      suspensoEm: null,
      justificativaSuspensao: null,
      semProva: true,
    });
    return id;
  }

  async profissional(_c: ContextoRegistro, login: string): Promise<ProfissionalDoRegistro | null> {
    const cbo = cboDe(login);
    if (cbo === null) return null;
    return {
      idUsuario: 1,
      idProfissional: 1,
      nome: `PROFISSIONAL ${M}`,
      cbo,
      cbos: [cbo],
      especialidades: [1],
      permiteRetroativo: true,
    };
  }

  async modelos(): Promise<ModeloDoRegistro[]> {
    return Object.entries(MODELOS).map(([id, m]) => ({
      id: Number(id),
      codigo: m.codigo,
      nome: m.nome,
      tipoComposicao: 2,
      nomeTipoComposicao: m.tipo,
      especialidades: [],
      aposentado: false,
      usoRecente: 120,
    }));
  }

  async definicao(_c: ContextoRegistro, modelo: number) {
    return definicaoSintetica(modelo);
  }

  async selo(_c: ContextoRegistro, modelo: number) {
    return `${MODELOS[modelo]?.perguntas.length ?? 0}.1.1.1.1`;
  }

  async atendimentos(_c: ContextoRegistro, paciente: number): Promise<AtendimentoLido[]> {
    if (!PACIENTES[paciente]) return [];
    const hoje = agoraLocal().slice(0, 10);
    return [
      {
        id: paciente * 10 + 1,
        numero: 31337,
        tipo: 'internacao',
        aberto: true,
        entrada: `${hoje}T07:00:00.000`,
        unidade: `UNIDADE ${M}`,
        leito: '101A',
        altaMedica: null,
        saida: null,
      },
      {
        id: paciente * 10 + 2,
        numero: 31336,
        tipo: 'pronto_atendimento',
        aberto: false,
        entrada: '2026-05-05T10:00:00.000',
        unidade: `PRONTO ATENDIMENTO ${M}`,
        leito: null,
        altaMedica: '2026-05-05T12:00:00.000',
        saida: null,
      },
    ];
  }

  async retratos(_c: ContextoRegistro, atendimento: number, paciente: number) {
    if (!PACIENTES[paciente] || Math.floor(atendimento / 10) !== paciente) return null;
    return { htAtendimento: atendimento * 10, htPaciente: paciente * 10, doPaciente: true };
  }

  async rascunhosDoProfissional(c: ContextoRegistro, cbos: readonly number[]) {
    return this.rasc(c.hospital)
      .filter((r) => r.fechado === null && cbos.includes(r.cbo))
      .map((r) => this.lidoDe(r))
      .reverse();
  }

  async rascunhosDoPaciente(c: ContextoRegistro, paciente: number, modelo: number) {
    return this.rasc(c.hospital)
      .filter((r) => r.fechado === null && r.paciente === paciente && r.modelo === modelo)
      .map((r) => this.lidoDe(r))
      .reverse();
  }

  async lerRascunho(c: ContextoRegistro, id: number) {
    const r = this.rasc(c.hospital).find((x) => x.id === id);
    return r
      ? {
          rascunho: this.lidoDe(r),
          linhas: r.linhas.map(lida),
          aberto: r.fechado === null,
          substituido: r.fechado === 'arquivado',
        }
      : null;
  }

  async ultimoRegistro(c: ContextoRegistro, paciente: number, modelo: number) {
    const r = this.regs(c.hospital)
      .filter((x) => x.paciente === paciente && x.modelo === modelo && x.suspensoEm === null)
      .at(-1);
    return r ? { registro: r.id, linhas: r.linhas.map(lida) } : null;
  }

  async historico(c: ContextoRegistro, paciente: number, modelo: number, ordem: string) {
    return this.regs(c.hospital)
      .filter(
        (x) =>
          x.paciente === paciente &&
          x.modelo === modelo &&
          x.suspensoEm === null &&
          x.linhas.some((l) => l.ordem === ordem),
      )
      .reverse()
      .slice(0, 20)
      .map((x) => ({
        registro: x.id,
        dataHora: `${x.dataHoraClinica}:00.000`,
        linhas: x.linhas.filter((l) => l.ordem === ordem).map(lida),
      }));
  }

  async cabecalhoRegistro(c: ContextoRegistro, registro: number): Promise<CabecalhoRegistroLido | null> {
    const r = this.regs(c.hospital).find((x) => x.id === registro);
    if (!r) return null;
    return {
      id: r.id,
      paciente: r.paciente,
      modelo: r.modelo,
      idHtPaciente: r.paciente * 10,
      idHtAtendimento: r.atendimento * 10,
      atendimento: r.atendimento,
      cbo: r.cbo,
      dataHoraClinica: `${r.dataHoraClinica}:00.000`,
      lancadoEm: r.lancadoEm,
      suspensoEm: r.suspensoEm,
      justificativaSuspensao: r.justificativaSuspensao,
      profissionalNome: `PROFISSIONAL ${M}`,
      corrige: r.corrige,
    };
  }

  async respostasRegistro(c: ContextoRegistro, registro: number) {
    return (this.regs(c.hospital).find((x) => x.id === registro)?.linhas ?? []).map(lida);
  }

  async prova(c: ContextoRegistro, registro: number): Promise<ProvaLida> {
    const r = this.regs(c.hospital).find((x) => x.id === registro);
    if (!r || r.semProva) return { guardado: null, hashConteudo: null, atual: null, comoSuporte: [] };
    return {
      guardado: r.hash,
      hashConteudo: r.hash,
      atual: r.alteradoFora ? `${r.hash.slice(0, 63)}x` : r.hash,
      comoSuporte: [...r.comoSuporte],
    };
  }

  async cabecalhoDocumento(
    _c: ContextoRegistro,
    retratos: { htPaciente: number; htAtendimento: number },
    cbo: number,
    situacao: number,
  ): Promise<CabecalhoDocumentoLido> {
    return {
      hospital: [
        ['id_tbhospit', 1],
        ['nome', `HOSPITAL ${M}`],
      ],
      paciente: [
        ['id_htpaciente', retratos.htPaciente],
        ['nome', PACIENTES[Math.floor(retratos.htPaciente / 10)] ?? M],
      ],
      atendimento: [
        ['id_htatendimento', retratos.htAtendimento],
        ['tipo_atendimento', 'Internação'],
      ],
      profissional: [
        ['id_tbcbopro', cbo],
        ['nome', `PROFISSIONAL ${M}`],
      ],
      tipoAssinatura: 'Anamnese/Evolução',
      situacao: situacao === 2 ? 'Suspenso' : 'Lançado',
    };
  }

  async modelosImpressao() {
    return {
      fichas: [{ id: 1, nome: `FICHA DE EVOLUÇÃO ${M}`, tipo: 1, componente: 'qrFicha' }],
      relatorios: [{ id: 1, nome: `RELATÓRIO DO REGISTRO ${M}` }],
    };
  }

  async agora() {
    return agoraLocal();
  }

  async podeGravar() {
    return { pode: true, codigo: null, motivo: null };
  }

  private conferirCbo(cbo: number, login: string): void {
    if (cboDe(login) !== cbo)
      throw new ErroOperacao(
        409,
        'profissional-sem-cbo',
        'Operação recusada',
        'Só o profissional da sessão registra.',
      );
  }

  /** As conferências da receita sobre o rascunho de origem (o mesmo conjunto, na memória). */
  private rascunhoAberto(
    c: ContextoRegistro,
    ref: { id: number; versao: string },
    cbo: number,
    de: { paciente: number; modelo: number; atendimento?: number },
  ): RascunhoMemoria {
    const r = this.rasc(c.hospital).find((x) => x.id === ref.id);
    if (!r)
      throw new ErroOperacao(
        404,
        'registro-inexistente',
        'Rascunho não encontrado',
        'O rascunho não existe mais.',
      );
    if (r.fechado === 'excluido')
      throw new ErroOperacao(
        409,
        'rascunho-fechado',
        'Operação recusada',
        'O rascunho já foi finalizado ou descartado.',
      );
    if (r.fechado === 'arquivado' || this.versao(r) !== ref.versao)
      throw new ErroOperacao(
        409,
        'conflito-versao',
        'Rascunho alterado',
        'O rascunho foi alterado depois que você o abriu.',
        {
          colunas: ['rascunho'],
        },
      );
    // O importado (sem a marca de origem) é rascunho do autor como qualquer outro (ADR 0006).
    if (r.cbo !== cbo)
      throw new ErroOperacao(
        409,
        'rascunho-de-outro',
        'Operação recusada',
        'Rascunho de outro profissional.',
      );
    if (r.paciente !== de.paciente || r.modelo !== de.modelo)
      throw new ErroOperacao(
        409,
        'rascunho-de-outro-formulario',
        'Operação recusada',
        'Outro paciente ou formulário.',
      );
    if (de.atendimento !== undefined && r.atendimento !== de.atendimento)
      throw new ErroOperacao(409, 'rascunho-de-outro-atendimento', 'Operação recusada', 'Outro atendimento.');
    return r;
  }

  async registrar(c: ContextoRegistro, e: GravacaoEvolucao, ctx: CtxMemoria) {
    this.conferirCbo(e.cbo, loginDaOperacao(ctx));
    if (e.corrige !== undefined) {
      const o = this.regs(c.hospital).find((x) => x.id === e.corrige);
      if (!o || o.paciente !== e.paciente)
        throw new ErroOperacao(422, 'correcao-de-outro-paciente', 'Operação recusada', 'Outro paciente.');
      if (o.modelo !== e.modelo)
        throw new ErroOperacao(422, 'correcao-de-outro-modelo', 'Operação recusada', 'Outro modelo.');
      if (o.suspensoEm === null)
        throw new ErroOperacao(422, 'correcao-sem-suspensao', 'Operação recusada', 'Suspenda antes.');
      if (o.cbo !== e.cbo)
        throw new ErroOperacao(422, 'correcao-por-outro', 'Operação recusada', 'Só o autor corrige.');
    }
    if (e.rascunho) {
      const r = this.rascunhoAberto(c, e.rascunho, e.cbo, {
        paciente: e.paciente,
        modelo: e.modelo,
        atendimento: e.atendimento,
      });
      // Como o legado: o rascunho finalizado fica marcado excluído.
      r.fechado = 'excluido';
    }
    const id = this.proximo++;
    this.regs(c.hospital).push({
      id,
      paciente: e.paciente,
      modelo: e.modelo,
      atendimento: e.atendimento,
      cbo: e.cbo,
      dataHoraClinica: e.dataHoraClinica,
      lancadoEm: `${agoraLocal()}.000`,
      linhas: e.linhas,
      hash: e.hashConteudo,
      corrige: e.corrige ?? null,
      comoSuporte: e.comoSuporte ? ['criado'] : [],
      suspensoEm: null,
      justificativaSuspensao: null,
    });
    await this.auditar(c, ctx, 'pep.evolucao.registrada', {
      tabela: 'registro_assistencial',
      id,
      paciente: e.paciente,
    });
    this.ouvinte?.(c.hospital, {
      id,
      paciente: e.paciente,
      atendimento: e.atendimento,
      modelo: MODELOS[e.modelo]?.codigo ?? String(e.modelo),
      nomeModelo: MODELOS[e.modelo]?.nome ?? M,
      cbo: e.cbo,
      dataHoraClinica: e.dataHoraClinica,
      suspenso: false,
      hash: e.hashConteudo,
      fluxo: e.fluxo ?? null,
      supervisao: e.supervisao ?? null,
      login: loginDaOperacao(ctx),
    });
    return { registro: id, trilha: null };
  }

  async salvarRascunho(c: ContextoRegistro, e: GravacaoRascunho, ctx: CtxMemoria) {
    this.conferirCbo(e.cbo, loginDaOperacao(ctx));
    // Como o legado: salvar de novo cria a versão encadeada (o mesmo lançamento) e arquiva a anterior.
    const anterior = e.rascunho
      ? this.rascunhoAberto(c, e.rascunho, e.cbo, {
          paciente: e.paciente,
          modelo: e.modelo,
          atendimento: e.atendimento,
        })
      : null;
    const r: RascunhoMemoria = {
      id: this.proximo++,
      paciente: e.paciente,
      modelo: e.modelo,
      atendimento: e.atendimento,
      cbo: e.cbo,
      dataHoraClinica: e.dataHoraClinica,
      lancadoEm: anterior?.lancadoEm ?? `${agoraLocal()}.000`,
      justificativa: e.justificativaRetroativo ?? null,
      linhas: e.linhas,
      fechado: null,
      doNovo: true,
      anterior: anterior?.id ?? null,
      corrige: e.corrige ?? anterior?.corrige ?? null,
    };
    if (anterior) anterior.fechado = 'arquivado';
    this.rasc(c.hospital).push(r);
    await this.auditar(c, ctx, 'pep.rascunho.salvo', {
      tabela: 'registro_assistencial_rascunho',
      id: r.id,
      paciente: e.paciente,
    });
    return { rascunho: r.id, versao: this.versao(r), trilha: null };
  }

  async descartarRascunho(
    c: ContextoRegistro,
    e: { rascunho: number; versao: string; cbo: number },
    ctx: CtxMemoria,
  ) {
    this.conferirCbo(e.cbo, loginDaOperacao(ctx));
    const x = this.rasc(c.hospital).find((y) => y.id === e.rascunho);
    if (!x)
      throw new ErroOperacao(
        404,
        'registro-inexistente',
        'Rascunho não encontrado',
        'O rascunho não existe mais.',
      );
    const r = this.rascunhoAberto(c, { id: e.rascunho, versao: e.versao }, e.cbo, {
      paciente: x.paciente,
      modelo: x.modelo,
    });
    r.fechado = 'excluido';
    await this.auditar(c, ctx, 'pep.rascunho.descartado', {
      tabela: 'registro_assistencial_rascunho',
      id: r.id,
      paciente: r.paciente,
    });
  }

  async suspender(
    c: ContextoRegistro,
    e: { registro: number; cbo: number; justificativa: string; comoSuporte?: boolean | undefined },
    ctx: CtxMemoria,
  ) {
    this.conferirCbo(e.cbo, loginDaOperacao(ctx));
    if (ctx.reautenticadoEm === undefined)
      throw new ErroOperacao(
        401,
        'reautenticacao-necessaria',
        'Confirme a senha',
        'Confirme a senha para suspender.',
      );
    const r = this.regs(c.hospital).find((x) => x.id === e.registro);
    if (!r)
      throw new ErroOperacao(
        404,
        'registro-inexistente',
        'Registro não encontrado',
        'O registro não existe.',
      );
    if (r.suspensoEm !== null)
      throw new ErroOperacao(409, 'ja-suspenso', 'Operação recusada', 'O registro já está suspenso.');
    if (r.cbo !== e.cbo)
      throw new ErroOperacao(409, 'suspensao-por-outro', 'Operação recusada', 'Só o autor suspende.');
    r.suspensoEm = `${agoraLocal()}.000`;
    if (e.comoSuporte) r.comoSuporte.push('suspenso');
    r.justificativaSuspensao = e.justificativa;
    await this.auditar(c, ctx, 'pep.evolucao.suspensa', {
      tabela: 'registro_assistencial',
      id: r.id,
      paciente: r.paciente,
    });
  }
}
