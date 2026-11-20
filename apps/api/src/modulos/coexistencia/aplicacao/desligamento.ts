// Prontidão do desligamento por hospital (M58, etapa 1; ficha, seções 4, 7, 8 e 12): o painel da aba
// "Desligamento" da migração gradual e o cartão "Plataforma do banco" da verificação de schema. Lê, no banco do
// estabelecimento ativo, só agregados e estrutura (sessões de pessoa por dia, contas técnicas, plataforma, funções) e
// a checklist gravada em SGH_; junta o registro do fim do M43 (contas combinadas, fim registrado, DP-6) e o registro
// versionado dos passos (docs/coexistencia/desligamento/<h>.yaml). Registrar um item da checklist grava
// SGH_CFG_COEX_DESLIG com a SGH_TRILHA na mesma transação. Nada aqui desliga coisa alguma (regra 1; DP-6 no padrão):
// os passos ficam bloqueados até as autorizações e os ensaios. Falha fechada: o que não se mediu não conta.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  diferencaItemDesligamento,
  type CartaoPlataforma,
  caminhoRegistroDesligamento,
  CHAVE_ENTRADA_UTF8,
  type CharsetLegado,
  CONTAS_TECNICAS_DECLARADAS,
  definicaoParametro,
  esquemaCartaoPlataforma,
  esquemaPainelDesligamento,
  esquemaRegistrarItemDesligamento,
  esquemaRegistroDesligamento,
  EVENTOS_AUDITAVEIS,
  INVENTARIO_DESLIGAMENTO,
  JANELA_SEM_SESSAO_DIAS,
  JANELA_SEM_SESSAO_DIAS_CAP14,
  type PainelDesligamento,
  type PainelJanela,
  PARAMETRO_CHARSET_LEGADO,
  PERMISSOES_M58_CODIGOS,
  type PlataformaBanco,
  type RegistroDesligamento,
  type ResumoEnsaioFirebird5,
  type ResumoEnsaioUtf8,
  type ResultadoRegistroDesligamento,
} from '@sgh/contratos';
import {
  avaliarDias,
  avaliarInventario,
  avaliarPassos,
  avaliarSessoes,
  charsetConfere,
  diasDaJanelaFim,
  estadoDesligamento,
  funcoesExternas,
  funcoesExternasPendentes,
  inicioDaJanela,
  inicioDaJanelaFim,
  inventarioResolvido,
  loginsExcluidos,
  resolucoesDoRegistro,
  resolverParametro,
  restricaoEntrada,
  sequenciaSemSessao,
  sessoesCumpridas,
  valorTipado,
  versaoMaior,
} from '@sgh/dominio-config';
import type { FuncaoLida, PlataformaLida } from '@sgh/legado';
import { parse } from 'yaml';
import { ErroProblema } from '../../../problema.filter.js';
import { linhaTrilha, type SessaoCadastro } from '../../cadastro/comum.js';
import type { FonteConfiguracao } from '../../config/public-api.js';
import type { ContextoCoex, PortaCoexistencia } from '../porta.js';
import { lerRegistroEnsaio } from './ensaio-firebird5.js';
import { lerRegistroEnsaioUtf8 } from './ensaio-utf8.js';
import { fraseRetirada, montarPainelJanela } from './janela.js';
import { lerRegistroFim } from './fim.js';
import { gravadoOuArquivo, type RegistroGravadoCoex } from './registro.js';

/** A versão do motor da troca (F2): a partir da 4 as funções externas vêm desligadas (regra 5). */
const VERSAO_ALVO = 5;
/** As contas técnicas mudam com a TI (DP-16): 15 minutos de cache por hospital (a leitura leva segundos). */
const TTL_CONTAS_MS = 15 * 60_000;
/** Os ids do charset do Firebird que aparecem no catálogo das colunas de texto (o resto sai pelo número). */
const NOMES_CHARSET: Record<number, string> = {
  0: 'NONE',
  1: 'OCTETS',
  2: 'ASCII',
  4: 'UTF8',
  53: 'WIN1252',
};

export interface DependenciasDesligamento {
  readonly porta: PortaCoexistencia;
  /** docs/coexistencia/fim (o registro do fim do M43). */
  readonly raizFim: string;
  /** docs/coexistencia/desligamento (o registro versionado dos passos). */
  readonly raizDesligamento: string;
  /** tools/schema-check/homologado (a impressão digital homologada do hospital). */
  readonly pastaHomologada: string;
  /** docs/marcos/M58 (o relatório do ensaio do Firebird 5 de cada hospital); sem ela, nenhum ensaio. */
  readonly raizEnsaios?: string | null;
  /** A fonte dos parâmetros (o `legado.charset` do estabelecimento); sem ela, o padrão do registro. */
  readonly configuracao?: FonteConfiguracao | null;
  readonly agora?: () => number;
  /** W0-09: o registro do fim gravado pela tela que vale sobre o arquivo (null: vale o arquivo). */
  readonly registroGravado?: RegistroGravadoCoex | undefined;
}

export interface RegistroDesligamentoLido {
  readonly registro: RegistroDesligamento;
  readonly invalido: string | null;
}

/** O registro versionado dos passos do hospital (ausente ou fora do esquema: vazio, com o aviso; falha fechada). */
export function lerRegistroDesligamento(raiz: string, hospital: string): RegistroDesligamentoLido {
  const vazio = esquemaRegistroDesligamento.parse({ formato: 1, estabelecimento: hospital });
  const p = join(raiz, `${hospital}.yaml`);
  if (!existsSync(p)) return { registro: vazio, invalido: 'registro dos passos ausente' };
  try {
    const r = esquemaRegistroDesligamento.safeParse(parse(readFileSync(p, 'utf8')));
    if (!r.success)
      return {
        registro: vazio,
        invalido: `registro fora do esquema: ${r.error.issues[0]?.message ?? 'inválido'}`,
      };
    if (r.data.estabelecimento !== hospital)
      return { registro: vazio, invalido: 'registro de outro estabelecimento' };
    return { registro: r.data, invalido: null };
  } catch {
    return { registro: vazio, invalido: 'registro ilegível' };
  }
}

/** O resumo da impressão homologada do hospital (16 primeiros caracteres), ou null sem homologação. */
export function impressaoHomologada(pasta: string, hospital: string): string | null {
  try {
    const p = join(pasta, `${hospital}.json`);
    if (!existsSync(p)) return null;
    const j = JSON.parse(readFileSync(p, 'utf8')) as { resumo?: unknown; estabelecimento?: unknown };
    if (j.estabelecimento !== hospital || typeof j.resumo !== 'string') return null;
    return j.resumo.slice(0, 16);
  } catch {
    return null;
  }
}

const invalido = (detalhe: string, issues?: readonly { message: string }[]) =>
  new ErroProblema('entrada-invalida', 400, 'Dados inválidos', issues?.[0]?.message ?? detalhe);

export class ServicoDesligamento {
  private readonly contasDe = new Map<
    string,
    {
      em: number;
      contas: { declaradas: { conta: string; presente: boolean; escrita: boolean }[]; naoDeclaradas: number };
    }
  >();

  constructor(private readonly d: DependenciasDesligamento) {}

  private agora(): number {
    return this.d.agora ? this.d.agora() : Date.now();
  }

  /** O `legado.charset` do estabelecimento (rede ou estabelecimento); sem a fonte, o padrão (CP1252). */
  private async charsetParametro(c: ContextoCoex): Promise<CharsetLegado> {
    const def = definicaoParametro(PARAMETRO_CHARSET_LEGADO);
    if (!def) return 'CP1252';
    let valores: Awaited<ReturnType<FonteConfiguracao['valoresParametro']>>;
    try {
      valores = this.d.configuracao ? await this.d.configuracao.valoresParametro(c.rede, c.hospital) : [];
    } catch {
      valores = [];
    }
    const v = valorTipado(
      def,
      resolverParametro(
        def,
        valores,
        { rede: c.rede, empresa: null, estabelecimento: c.hospital, unidade: null, perfis: [], usuario: '' },
        new Date(this.agora()),
      ).valor,
    );
    return v === 'UTF8' ? 'UTF8' : 'CP1252';
  }

  private async entradaUtf8Ligada(c: ContextoCoex): Promise<boolean> {
    try {
      const chaves = await this.d.porta.chaves(c);
      return chaves.some(
        (k) =>
          k.tipo === 'recurso' &&
          k.chave === CHAVE_ENTRADA_UTF8 &&
          k.escopo === 'hospital' &&
          k.ligada === true,
      );
    } catch {
      return false;
    }
  }

  private plataforma(
    hospital: string,
    p: PlataformaLida,
    funcoes: readonly FuncaoLida[],
    charset: CharsetLegado,
  ): PlataformaBanco {
    let maior: number;
    try {
      maior = versaoMaior(p.versaoMotor);
    } catch {
      maior = 0;
    }
    return {
      versaoMotor: p.versaoMotor,
      versaoMaior: maior,
      ods: p.ods,
      charsetBanco: p.charsetBanco,
      charsetParametro: charset,
      charsetConfere: charsetConfere(p.charsetBanco, charset),
      funcoesExternas: funcoesExternas(funcoes),
      impressao: impressaoHomologada(this.d.pastaHomologada, hospital),
    };
  }

  async painel(s: SessaoCadastro): Promise<PainelDesligamento> {
    const c = s.porta;
    const { agora, hoje } = await this.d.porta.relogio(c);
    const gravadoFim = await gravadoOuArquivo(this.d.registroGravado, c, 'fim');
    const fim = lerRegistroFim(this.d.raizFim, c.hospital, gravadoFim).registro;
    const excluidos = loginsExcluidos(fim.contasCombinadas.map((x) => x.login));
    const { registro, invalido: registroInvalido } = lerRegistroDesligamento(
      this.d.raizDesligamento,
      c.hospital,
    );
    const guardadas = this.contasDe.get(`${c.rede}|${c.hospital}`);
    const contasValidas = guardadas && this.agora() - guardadas.em < TTL_CONTAS_MS ? guardadas.contas : null;
    const inicioFim = inicioDaJanelaFim(hoje);
    const [leitura, charset, retratos, serie] = await Promise.all([
      this.d.porta.leituraDesligamento(c, {
        desde: inicioDaJanela(hoje, JANELA_SEM_SESSAO_DIAS_CAP14),
        inicioJanela: inicioDaJanela(hoje, JANELA_SEM_SESSAO_DIAS),
        excluidos,
        comContas: contasValidas === null,
      }),
      this.charsetParametro(c),
      this.d.porta.retratos(c, inicioFim).catch(() => []),
      this.d.porta.serieOutroSistema(c, inicioFim).catch(() => []),
    ]);
    const contas = leitura.contas ?? contasValidas ?? { declaradas: [], naoDeclaradas: 0 };
    if (leitura.contas)
      this.contasDe.set(`${c.rede}|${c.hospital}`, { em: this.agora(), contas: leitura.contas });

    // Regra 3: a tabela de conexões (agregado por dia, sem as contas combinadas nem os painéis) e a medida diária.
    const sessoes = avaliarSessoes(
      leitura.sessoes.porDia,
      hoje,
      JANELA_SEM_SESSAO_DIAS,
      leitura.sessoes.distintosNaJanela,
    );
    const seq = sequenciaSemSessao(
      avaliarDias(diasDaJanelaFim(hoje, retratos, serie), excluidos),
      hoje,
      JANELA_SEM_SESSAO_DIAS,
    );
    const sessoesCumprido = sessoesCumpridas(sessoes, { dias: seq.dias });

    // Regra 2: o inventário com a checklist gravada.
    const itens = avaliarInventario(
      leitura.itens.map((i) => ({
        item: i.item,
        situacao: i.situacao,
        contingencia: i.contingencia,
        registradoEm: i.registradoEm,
        papelResponsavel: i.papelResponsavel,
        evidencia: i.evidencia,
      })),
    );

    // As contas declaradas com o destino, a presença e a escrita lidas no banco.
    const lidas = new Map(contas.declaradas.map((x) => [x.conta, x]));
    const declaradas = CONTAS_TECNICAS_DECLARADAS.map((x) => {
      const nome = x.prefixo ? `${x.conta}*` : x.conta;
      const l = lidas.get(nome);
      return {
        conta: nome,
        destino: x.destino,
        presente: l?.presente ?? false,
        escrita: l?.escrita ?? false,
      };
    });

    // Regras 5 e 6: a plataforma; as funções externas que bloqueiam a troca para a versão 5.
    const plataforma = this.plataforma(c.hospital, leitura.plataforma, leitura.funcoes, charset);
    const funcoesPendentes = funcoesExternasPendentes(
      plataforma.funcoesExternas,
      resolucoesDoRegistro(registro),
      VERSAO_ALVO,
    );
    const dp6 = fim.dp6;
    const passos = avaliarPassos(
      estadoDesligamento(registro, {
        fimRegistrado: fim.fimRegistrado !== null,
        dp6Decidida: dp6 !== null && 'decididaEm' in dp6,
        sessoesCumprido,
        inventarioResolvido: inventarioResolvido(itens),
        funcoesPendentes,
      }),
    );
    return esquemaPainelDesligamento.parse({
      hospital: c.hospital,
      em: agora.toISOString(),
      sessoes,
      itens,
      contas: { declaradas, naoDeclaradas: contas.naoDeclaradas },
      plataforma,
      passos,
      medidaDiaria: {
        diasLimpos: seq.dias,
        exigidos: JANELA_SEM_SESSAO_DIAS,
        paradaSemMedida: seq.paradaSemMedida,
        ultimaSessao: seq.ultimaSessao,
      },
      sessoesCumprido,
      ultimoDiaTabela: leitura.sessoes.ultimoDia,
      contasCombinadas: excluidos.length,
      fimRegistradoEm: fim.fimRegistrado?.data ?? null,
      dp6: {
        decididaEm: dp6 && 'decididaEm' in dp6 ? dp6.decididaEm : null,
        previstaPara: dp6 && 'previstaPara' in dp6 ? dp6.previstaPara : null,
      },
      registro: caminhoRegistroDesligamento(c.hospital),
      registroInvalido,
      podeRegistrar: s.pode(PERMISSOES_M58_CODIGOS.checklistRegistrar),
    });
  }

  /** O ensaio do Firebird 5 do hospital (M58-F2): o relatório versionado reavaliado e o registro do ensaio. */
  ensaioFirebird5(s: SessaoCadastro): Promise<ResumoEnsaioFirebird5> {
    // Não lê o banco: o ensaio roda na cópia, fora da API; o relógio é o do servidor.
    const h = s.porta.hospital;
    const { registro } = lerRegistroDesligamento(this.d.raizDesligamento, h);
    return Promise.resolve(
      lerRegistroEnsaio(this.d.raizEnsaios ?? null, h, new Date(this.agora()), registro),
    );
  }

  /** O ensaio da conversão para UTF-8 do hospital (M58-F3): o relatório versionado reavaliado e o registro. */
  ensaioUtf8(s: SessaoCadastro): Promise<ResumoEnsaioUtf8> {
    const h = s.porta.hospital;
    const { registro } = lerRegistroDesligamento(this.d.raizDesligamento, h);
    return Promise.resolve(
      lerRegistroEnsaioUtf8(this.d.raizEnsaios ?? null, h, new Date(this.agora()), registro),
    );
  }

  /**
   * A janela em produção de cada passo (M58-F5): o roteiro com os tempos dos ensaios, a verificação depois da janela
   * (produção e ensaio do roteiro) e a retirada da restrição de entrada. Lê o charset do banco e o parâmetro.
   */
  async janela(s: SessaoCadastro): Promise<PainelJanela> {
    return this.painelJanela(s.porta);
  }

  private async painelJanela(c: ContextoCoex): Promise<PainelJanela> {
    const [{ agora }, lido, charset, ligada] = await Promise.all([
      this.d.porta.relogio(c),
      this.d.porta.plataformaBanco(c),
      this.charsetParametro(c),
      this.entradaUtf8Ligada(c),
    ]);
    const { registro, invalido } = lerRegistroDesligamento(this.d.raizDesligamento, c.hospital);
    return montarPainelJanela({
      hospital: c.hospital,
      em: agora,
      raizEnsaios: this.d.raizEnsaios ?? null,
      registro,
      registroInvalido: invalido,
      charsetBanco: lido.plataforma.charsetBanco,
      charsetParametro: charset,
      chaveLigada: ligada,
    });
  }

  /**
   * Regra 6 (ficha, seção 12), em todo ambiente: ligar `entrada.utf8` exige o UTF-8 autorizado, executado e verificado
   * na produção, com o banco e o parâmetro em UTF-8. Devolve a frase do que falta (null: pode ligar). Falha fechada:
   * sem conseguir ler o banco, não liga.
   */
  async motivoLigarEntradaUtf8(c: ContextoCoex): Promise<string | null> {
    try {
      const p = await this.painelJanela(c);
      return fraseRetirada(p.retirada.motivos);
    } catch {
      return 'A entrada sem restrição de caracteres não pôde ser conferida agora (o banco do estabelecimento não respondeu).';
    }
  }

  async cartaoPlataforma(s: SessaoCadastro): Promise<CartaoPlataforma> {
    const c = s.porta;
    const [{ agora }, lido, charset, ligada] = await Promise.all([
      this.d.porta.relogio(c),
      this.d.porta.plataformaBanco(c),
      this.charsetParametro(c),
      this.entradaUtf8Ligada(c),
    ]);
    const { registro } = lerRegistroDesligamento(this.d.raizDesligamento, c.hospital);
    const plataforma = this.plataforma(c.hospital, lido.plataforma, lido.funcoes, charset);
    const porTipo = new Map<
      string,
      { tipo: 'char' | 'varchar' | 'blob-texto'; charset: string; colunas: number }
    >();
    for (const x of lido.plataforma.colunasTexto) {
      const cs =
        x.charsetId === null ? 'sem codificação' : (NOMES_CHARSET[x.charsetId] ?? `id ${x.charsetId}`);
      const k = `${x.tipo}|${cs}`;
      const a = porTipo.get(k);
      porTipo.set(k, { tipo: x.tipo, charset: cs, colunas: (a?.colunas ?? 0) + x.colunas });
    }
    return esquemaCartaoPlataforma.parse({
      hospital: c.hospital,
      em: agora.toISOString(),
      plataforma,
      restricaoEntrada: restricaoEntrada(charset, ligada && plataforma.charsetConfere),
      funcoesPendentes: funcoesExternasPendentes(
        plataforma.funcoesExternas,
        resolucoesDoRegistro(registro),
        VERSAO_ALVO,
      ),
      colunasTexto: [...porTipo.values()].sort(
        (a, b) => a.tipo.localeCompare(b.tipo) || b.colunas - a.colunas,
      ),
      indicesComTexto: lido.plataforma.indicesComTexto,
    });
  }

  /** Regra 2: o substituto em uso ou o aceite da área, com a contingência, o papel e a evidência (reautenticado). */
  async registrar(s: SessaoCadastro, item: string, corpo: unknown): Promise<ResultadoRegistroDesligamento> {
    const b = (corpo ?? {}) as Record<string, unknown>;
    const p = esquemaRegistrarItemDesligamento.safeParse({
      item,
      situacao: b['situacao'],
      contingencia: b['contingencia'],
      papelResponsavel: b['papelResponsavel'],
      evidencia: b['evidencia'],
    });
    if (!p.success)
      throw invalido('Revise a situação, a contingência, o papel e a evidência.', p.error.issues);
    const def = INVENTARIO_DESLIGAMENTO.find((i) => i.id === p.data.item);
    if (!def) throw new ErroProblema('nao-encontrado', 404, 'Item fora do inventário');
    if (p.data.situacao === 'substituto-em-uso' && (!def.substituto || def.substituto.aConfirmar))
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Substituto não confirmado',
        def.substituto
          ? 'A equivalência deste item ainda não foi confirmada com a TI: registre o aceite da área.'
          : 'Este item não tem substituto: registre o aceite da área.',
        { codigo: 'substituto-nao-confirmado' },
      );
    const situacao = p.data.situacao as Exclude<typeof p.data.situacao, 'pendente'>;
    const novo = {
      item: p.data.item,
      situacao,
      contingencia: p.data.contingencia,
      papelResponsavel: p.data.papelResponsavel.trim(),
      evidencia: p.data.evidencia.trim(),
    };
    const base = {
      ...linhaTrilha(
        s,
        EVENTOS_AUDITAVEIS.coexistenciaDesligamentoItemRegistrado.codigo,
        'config.desligamento',
        `desligamento:${p.data.item}`.slice(0, 80),
        {
          tabela: 'SGH_CFG_COEX_DESLIG',
          id: null,
          chave: `${s.porta.hospital}:${p.data.item}`.slice(0, 120),
        },
      ),
    };
    // A linha anterior é lida na mesma transação, antes do UPDATE: a trilha guarda os códigos de antes e depois.
    const r = await this.d.porta.gravarSgh(
      s.porta,
      (x: { anterior: Parameters<typeof diferencaItemDesligamento>[0] }) => ({
        ...base,
        diferenca: diferencaItemDesligamento(x.anterior, novo),
      }),
      (g) => g.gravarItemDesligamento(novo, s.login),
    );
    return { item: p.data.item, registradoEm: new Date(r.registradoEm).toISOString() };
  }
}
