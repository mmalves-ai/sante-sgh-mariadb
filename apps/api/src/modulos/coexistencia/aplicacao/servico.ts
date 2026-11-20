// Serviço do painel de migração gradual (ficha do M37, seções 4 a 8): setores com a parcela no novo (regra 2) e a
// avaliação de setor migrado (regra 10), pessoas com os dias desde a última conexão no outro sistema (regra 1), trilhas
// e conclusões (regras 3 e 4), indicadores do cap-15 §15.3.4, lote de liberação (regra 3a), condução opcional (regra 6)
// e chamados com os prazos de severidade (regra 7). As gravações vão à porta (só SGH_, com a trilha na mesma
// transação); a condução, pela operação do protocolo de permissões do grupo (executor). Nenhum dado de paciente.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AVISO_TEXTO_CHAMADO,
  type ChamadoLido,
  type GuiaTreino,
  TIPOS_GUIA_TREINO,
  ESTABELECIMENTO_PRIMEIRO_DP4,
  esquemaAbrirChamado,
  esquemaDevolverConducao,
  esquemaEditarSetor,
  esquemaFiltroChamados,
  esquemaPedidoLoteCoex,
  esquemaPublicarTrilha,
  esquemaRecolherLote,
  esquemaRegistrarConclusao,
  esquemaRetirarConducao,
  esquemaTriarChamado,
  estadoEm,
  EVENTOS_AUDITAVEIS,
  type ListaChamados,
  PAPEIS,
  PAPEIS_TREINAMENTO,
  PERMISSOES_M37,
  type PainelConducao,
  type PainelIndicadores,
  type PainelSetores,
  type PainelTreino,
  type PaginaPessoas,
  type PapelTreinamento,
  type ResultadoConducao,
  type ResultadoLoteCoex,
  recursoDesligado,
  type SetorCoex,
  SETORES_PRONTIDAO,
  type SituacaoSetorCoex,
  TAMANHO_PAGINA_CHAMADOS,
  TAREFAS_TREINAMENTO,
  TOTAL_REFERENCIA_PUBLICO,
  type TrilhaCoex,
  operacoesDoSetor,
  CODIGO_LISTA_LIGAR_INCOMPLETA,
  OPERACOES_FICHA_ONDA_1,
  esquemaGravarItensLigar,
  type ItemLigar,
  type PainelOnda1,
  SETORES_ONDA_1,
  TELAS_ONDA_1,
  type AcompanhamentoOnda2,
  CODIGO_CRITERIO_ONDA_2_INCOMPLETO,
  CODIGOS_BAIXA_CONFIANCA_ONDA_2,
  esquemaConsultaAcompanhamento,
  esquemaGravarItensOnda2,
  type ItemCriterioRegistrado,
  JANELAS_SEM_VERSAO_PADRAO,
  OPERACOES_CATALOGO_ONDA_2,
  ORDEM_SETORES_ONDA_2,
  type PainelHomologacao,
  type PainelOnda2,
  RECURSOS_SO_NO_NOVO,
  SETORES_ONDA_2,
  CODIGO_CRITERIO_ONDA_3_INCOMPLETO,
  CODIGO_FARMACIA_SEM_PRESCRICAO,
  CODIGOS_BAIXA_CONFIANCA_ONDA_3,
  esquemaPainelMigracaoOnda3,
  MOTIVO_FORA_DA_ONDA3,
  OPERACOES_CATALOGO_ONDA_3,
  ORDEM_SETORES_ONDA_3,
  type PainelMigracaoOnda3,
  RECURSOS_FORA_DA_ONDA3,
  RECURSOS_SO_NO_NOVO_ONDA_3,
  SETORES_ONDA_3,
  CODIGO_CRITERIO_ONDA_4_INCOMPLETO,
  CODIGO_FORA_DA_ABERTURA,
  ENVIOS_SUS_FORA_DA_ONDA,
  esquemaPainelMigracaoOnda4,
  operacoesSusNaOnda4,
  ORDEM_SETORES_ONDA_4,
  type PainelMigracaoOnda4,
  RECURSOS_SO_NO_NOVO_ONDA_4,
  ROTULO_MOMENTO_ONDA_4,
  SAIDAS_EXTERNAS_ONDA_4,
  saidaExternaPermitida,
  SETORES_ONDA_4,
  SETORES_ONDA_4_PRONTIDAO,
  TURNOS_TREINO,
  type TurnoTreino,
} from '@sgh/contratos';
import {
  CODIGOS_BAIXA_CONFIANCA_ONDA_4,
  conferirAberturaDaCompetencia,
  diasDeFechamento,
  FECHAMENTO_PADRAO,
  feriadosNacionais,
} from '@sgh/contratos/regras-faturamento';
import {
  avaliarSetorMigrado,
  calcularParcela,
  chamadoVencido,
  chavePar,
  colunaDaSituacao,
  conferirRetirada,
  conferirTriagem,
  contagemSegura,
  decidirChave,
  diasDesdeUltimaConexao,
  filaS2PorDia,
  montarSetores,
  aguardandoPrimeiro,
  papelDoGrupo,
  pessoaNoSetor,
  planejarLote,
  planejarLoteCoexistencia,
  prazosDoChamado,
  type PrazoSeveridade,
  PRAZOS_PROPOSTOS,
  proporConducao,
  proximaAtualizacaoS1,
  publicoPorPapel,
  seriePessoasPorDia,
  type SetorGravado,
  type SetorMontado,
  somarParcelas,
  transicaoPermitida,
  avaliarLigarSetor,
  type ContagemDisputa,
  disputaDosDias,
  disputaPendente,
  ehSetorOnda1,
  motivoLoteOnda1,
  avaliarLiberacaoSetor,
  ehSetorOnda2,
  indicadorChecagem,
  indicadorHigienizacao,
  motivoLoteOnda2,
  operacaoForaDaOnda,
  setoresOnda2DaChave,
  passoDoSetorOnda2,
  planoRecolhimento,
  recursosSoNoNovoDoSetor,
  registrosPorSistema,
  setoresQueSeguramHospital,
  versaoPermitida,
  anterioresNaoLiberados,
  chaveExigePrescricao,
  ehSetorOnda3,
  itensDoSetor,
  passoDoSetorOnda3,
  prioridadeOnda3,
  setoresOnda3DaChave,
  ajustarAberturaOnda4,
  ehSetorOnda4,
  lerSituacoesRespostas,
  momentoDoSetorOnda4,
  motivoForaDaAbertura,
  passoDoSetorOnda4,
  respostasDoSetorOnda4,
  setorExigeAbertura,
  setoresOnda4DaChave,
  type SituacaoRespostaLida,
  concluidasPorTurno,
} from '@sgh/dominio-config';
import {
  type DisputaDoDia,
  fonteCatalogoArquivo,
  lerCatalogoOperacoes,
  type LinhaTrilha,
  type PessoaCoexLida,
} from '@sgh/legado';

type CatalogoOperacoes = ReturnType<typeof lerCatalogoOperacoes>;
import { CATALOGO_COMPLETO } from '../../../autorizacao/catalogo.js';
import type { RegistradorTrilha } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import { carregarDominiosVistos, type ContextoOperacao, type DominiosVistos } from '@sgh/legado';
import { linhaTrilha, type SessaoCadastro } from '../../cadastro/comum.js';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../../autorizacao/estacao.js';
import type { FonteAdministracao } from '../../administracao/fonte.js';
import {
  type CacheConfig,
  type CriterioLigarSetor,
  type FonteConfiguracao,
} from '../../config/public-api.js';
import { ConfiguracaoM34 } from '../../relatorio/public-api.js';
import type { ContextoCoex, PortaCoexistencia } from '../porta.js';
import { MEDIDOR_TAREFAS, type MedidorTarefas } from './medidor-tarefas.js';

const TTL_PESSOAS_S = 3_600;
const ROTA_GUIAS = 'administracao/coexistencia/migracao/treinamento/guias';
/** Janela do "último uso no novo" na lista por pessoa (dias; a leitura vai pelo índice de usuário e dia da trilha). */
const DIAS_ULTIMO_USO_NOVO = 90;
const DIA = 86_400_000;
const FUSO_BANCO = 'UTC'; // As datas do banco chegam como relógio de parede nos campos UTC.

function invalido(
  detalhe: string,
  issues?: readonly { message: string; path: readonly PropertyKey[] }[],
): ErroProblema {
  return new ErroProblema('entrada-invalida', 400, 'Dados inválidos', issues?.[0]?.message ?? detalhe);
}
const recusa = (titulo: string, detalhe: string, codigo = 'recusa-de-negocio') =>
  new ErroProblema('recusa-de-negocio', 409, titulo, detalhe, { codigo });

/** O setor da onda 1 de uma operação do catálogo (as da ficha do M39), ou null. */
function setorDaOperacaoOnda1(operacao: string): string | null {
  return OPERACOES_FICHA_ONDA_1.find((o) => o.catalogo.includes(operacao))?.setor ?? null;
}

const somarDias = (dia: string, n: number) =>
  new Date(Date.parse(`${dia}T00:00:00Z`) + n * DIA).toISOString().slice(0, 10);

/** As opções do legado das permissões de um módulo (o módulo é a primeira parte do código). */
function opcoesDosModulos(modulos: ReadonlySet<string>): Set<number> {
  const r = new Set<number>();
  for (const p of CATALOGO_COMPLETO)
    if (modulos.has(p.codigo.split('.')[0] ?? '')) for (const o of p.opcoesLegado) r.add(o);
  return r;
}

export interface DependenciasMigracao {
  readonly porta: PortaCoexistencia;
  readonly trilha: RegistradorTrilha;
  readonly administracao: FonteAdministracao | null;
  readonly fonteConfig: FonteConfiguracao | null;
  readonly cache: CacheConfig | null;
  readonly caminhoCatalogo: string;
  readonly ambiente: string;
  readonly grafana: string | null;
  /** O método de mascaramento do treino registrado pelo dono (DP-41); sem ele, o treino fica sobre massa sintética. */
  readonly metodoMascaramento: string | null;
  readonly medidor?: MedidorTarefas;
  /** DP-4: o estabelecimento que vai primeiro (o primeiro de ESTABELECIMENTOS; na Rede Santé, o ProntoCardio). */
  readonly primeiro?: { readonly codigo: string; readonly nome: string } | undefined;
  /** A pasta dos guias e roteiros gerados (docs/prontidao/treinamento); sem ela, a rota dos guias responde 404. */
  readonly raizTreinamento?: string | undefined;
  /** M39: as contagens de disputa do executor deste processo, por dia civil (indicadores de disputa da onda 1). */
  readonly metricas?: { doDia(dia: string): readonly DisputaDoDia[] } | undefined;
  /** M40: o painel da homologação do M36 (a situação do pentest entra no critério); sem ele, o item fica pendente. */
  readonly homologacao?: { painel(): PainelHomologacao | null } | undefined;
  /** M41: o registro dos avaliadores da tela de chaves (o mapa da regra 1 da onda 3 vem do estoque por ele). */
  readonly criterio?: CriterioLigarSetor | undefined;
  /** M42 (regra 8): a pasta do acompanhamento das respostas do faturamento e do fiscal (respostas/*.md). */
  readonly raizRespostas?: string | undefined;
}

/** M40: o acompanhamento da onda 2 guardado por 1 h por estabelecimento e período (consulta pesada; campo 4). */
const TTL_ACOMPANHAMENTO_S = 3_600;

export class ServicoMigracao {
  private readonly config: ConfiguracaoM34;
  private readonly medidor: MedidorTarefas;
  private readonly primeiro: { readonly codigo: string; readonly nome: string };
  /** M39: o estado efetivo das operações (uma leitura do catálogo a cada 5 s, não uma por setor). */
  private readonly fonteCatalogo: ReturnType<typeof fonteCatalogoArquivo>;
  /**
   * Revisão do M39: o que este processo já somou em SGH_CFG_COEX_USO_DIA, por dia e (estabelecimento|operação) — o
   * total do executor no último retrato bem-sucedido. O retrato seguinte manda só a diferença.
   */
  private readonly disputaGravada = new Map<string, Map<string, ContagemDisputa>>();
  constructor(private readonly d: DependenciasMigracao) {
    this.fonteCatalogo = fonteCatalogoArquivo(d.caminhoCatalogo);
    this.config = new ConfiguracaoM34(d.fonteConfig, d.cache);
    this.medidor = d.medidor ?? MEDIDOR_TAREFAS;
    this.primeiro = d.primeiro ?? { codigo: ESTABELECIMENTO_PRIMEIRO_DP4, nome: 'ProntoCardio' };
  }

  private espera(hospital: string, doPrimeiro: SetorMontado[] | null) {
    return aguardandoPrimeiro(hospital, doPrimeiro, this.primeiro.codigo, this.primeiro.nome);
  }

  private catalogo(): CatalogoOperacoes {
    return lerCatalogoOperacoes(this.d.caminhoCatalogo);
  }

  private trilhaDe(
    s: SessaoCadastro,
    evento: string,
    operacao: string,
    alvo: { tabela: string; id?: string | null; chave?: string | null },
  ): LinhaTrilha {
    return linhaTrilha(s, evento, 'config.coexistencia', operacao, alvo);
  }

  /** A estação e a correlação da requisição (as mesmas de linhaTrilha), para as linhas da trilha montadas aqui. */
  private origem(s: SessaoCadastro, rotulo: string): { estacao: string; correlacao: string } {
    return {
      estacao: estacaoDaRequisicao(s.req).slice(0, 80),
      correlacao: correlacaoDaRequisicao(s.req, rotulo).slice(0, 64),
    };
  }

  // ── Leituras de base ────────────────────────────────────────────────────────────────────────────────

  private async pessoas(c: ContextoCoex): Promise<PessoaCoexLida[]> {
    const carregar = () => this.d.porta.pessoas(c);
    if (!this.d.cache || this.d.porta.destino === 'memoria') return carregar();
    return this.d.cache.lerOuCarregar(
      this.d.cache.chave(c.rede, c.hospital, 'coex-pessoas'),
      TTL_PESSOAS_S,
      carregar,
    );
  }

  private async setoresMontados(c: ContextoCoex): Promise<SetorMontado[]> {
    const gravados = (await this.d.porta.setores(c)).map((g): SetorGravado => ({
      ...g,
      situacao: g.situacao as SituacaoSetorCoex,
      composicao: g.composicao as SetorGravado['composicao'],
    }));
    return montarSetores(gravados, (k) => !!recursoDesligado(k));
  }

  private conclusoesValidas(conclusoes: Awaited<ReturnType<PortaCoexistencia['conclusoes']>>) {
    return conclusoes
      .filter((x) => (PAPEIS_TREINAMENTO as readonly string[]).includes(x.papel))
      .map((x) => ({
        login: x.login,
        papel: x.papel as PapelTreinamento,
        onda: x.onda,
        resultado: x.resultado,
        concluidoEm: x.concluidoEm,
      }));
  }

  private setorDoLote(s: SetorMontado) {
    return {
      codigo: s.codigo,
      onda: s.onda,
      situacao: s.situacao,
      papeis: s.definicao?.papeis ?? [],
      composicao: s.composicao,
    };
  }

  private async prazos(c: ContextoCoex): Promise<{ prazos: PrazoSeveridade[]; aprovado: boolean }> {
    const n = async (k: string, p: number) => {
      const v = await this.config.parametro(c, k);
      return typeof v === 'number' ? v : p;
    };
    const [s1, s2, s3, s4] = PRAZOS_PROPOSTOS as [
      PrazoSeveridade,
      PrazoSeveridade,
      PrazoSeveridade,
      PrazoSeveridade,
    ];
    const prazos: PrazoSeveridade[] = [
      {
        ...s1,
        resposta: await n('coexistencia.chamadoS1RespostaMin', s1.resposta),
        contorno: await n('coexistencia.chamadoS1ContornoMin', s1.contorno),
      },
      {
        ...s2,
        resposta: await n('coexistencia.chamadoS2RespostaMin', s2.resposta),
        contorno: await n('coexistencia.chamadoS2ContornoMin', s2.contorno),
      },
      {
        ...s3,
        resposta: await n('coexistencia.chamadoS3RespostaDiasUteis', s3.resposta),
        contorno: await n('coexistencia.chamadoS3ContornoDiasUteis', s3.contorno),
      },
      {
        ...s4,
        resposta: await n('coexistencia.chamadoS4RespostaDiasUteis', s4.resposta),
        contorno: await n('coexistencia.chamadoS4ContornoDiasUteis', s4.contorno),
      },
    ];
    return { prazos, aprovado: (await this.config.parametro(c, 'coexistencia.prazosAprovados')) === true };
  }

  // ── Setores ─────────────────────────────────────────────────────────────────────────────────────────

  async painelSetores(s: SessaoCadastro): Promise<PainelSetores> {
    const c = s.porta;
    const [setores, pessoas, conclusoes, chaves, publico, lotes, relogio] = await Promise.all([
      this.setoresMontados(c),
      this.pessoas(c),
      this.d.porta.conclusoes(c),
      this.d.porta.chaves(c),
      this.d.porta.publicoPorGrupo(c),
      this.d.porta.lotes(c),
      this.d.porta.relogio(c),
    ]);
    const validas = this.conclusoesValidas(conclusoes);
    const desde = somarDias(relogio.hoje, -28);
    const [uso, aoVivo, chamados, retratos] = await Promise.all([
      this.d.porta.usoDia(c, desde),
      this.d.porta.usoAoVivo(c, relogio.hoje).catch(() => []),
      // Os da janela e os ainda abertos de antes (a fila de S2 da regra 10); teto de 2.000.
      this.d.porta.chamados(c, { desde, ouAbertos: true, limite: 2_000 }),
      this.d.porta.retratos(c, desde),
    ]);
    const ligadasPessoa = new Set(
      chaves
        .filter((k) => k.escopo === 'pessoa' && k.ligada === true)
        .map((k) => `${k.chave}|${k.valor.toUpperCase()}`),
    );
    // DP-4: o segundo estabelecimento espera o primeiro (lido no banco do primeiro).
    let espera: { aguardando: boolean; motivo: string | null } = { aguardando: false, motivo: null };
    if (c.hospital !== this.primeiro.codigo) {
      const doPrimeiro = await this.setoresMontados({ rede: c.rede, hospital: this.primeiro.codigo }).catch(
        () => null,
      );
      espera = this.espera(c.hospital, doPrimeiro);
    }
    const diasSemS1 = Number(await this.config.parametro(c, 'coexistencia.migradoDiasSemS1')) || 14;
    const diasConexoes = Number(await this.config.parametro(c, 'coexistencia.migradoDiasConexoes')) || 14;
    const resultado: SetorCoex[] = setores.map((st) => {
      const sl = this.setorDoLote(st);
      const doSetor = pessoas.filter((p) => pessoaNoSetor({ ...p, ativo: true }, sl));
      const logins = new Set(doSetor.map((p) => p.login.toUpperCase()));
      const treinados = doSetor.filter((p) =>
        validas.some(
          (x) =>
            x.login.toUpperCase() === p.login.toUpperCase() &&
            x.papel === papelDoGrupo(p.grupo) &&
            x.onda === st.onda &&
            x.resultado === 'aprovado',
        ),
      ).length;
      const comAcesso = doSetor.filter((p) =>
        st.chaves.some((k) => ligadasPessoa.has(`${k.chave}|${p.login.toUpperCase()}`)),
      ).length;
      const ultimoDia = [...uso.filter((u) => u.setor === st.codigo)]
        .map((u) => u.dia)
        .sort()
        .at(-1);
      const parcela = ultimoDia
        ? somarParcelas(
            uso
              .filter((u) => u.setor === st.codigo && u.dia === ultimoDia)
              .map((u) => calcularParcela(u.noNovo + u.noLegado, u.noNovo)),
          )
        : somarParcelas(
            aoVivo.filter((u) => u.setor === st.codigo).map((u) => calcularParcela(u.linhasDoDia, u.doNovo)),
          );
      const doSetorChamados = chamados.filter((x) => x.setor === st.codigo);
      // A fila de S2 do setor por dia na janela da regra 10 (S2 abertos em cada dia, inclusive os de antes ainda abertos).
      const filaS2 = filaS2PorDia(
        doSetorChamados
          .filter((x) => x.severidade === 'S2')
          .map((x) => ({
            abertoEm: x.abertoEm.toISOString().slice(0, 10),
            encerradoEm:
              x.situacao === 'resolvido'
                ? (x.resolvidoEm ?? x.atualizadoEm ?? x.abertoEm).toISOString().slice(0, 10)
                : x.situacao === 'cancelado'
                  ? (x.atualizadoEm ?? x.abertoEm).toISOString().slice(0, 10)
                  : null,
          })),
        somarDias(relogio.hoje, -(diasSemS1 - 1)),
        relogio.hoje,
      );
      const migrado = avaliarSetorMigrado({
        hoje: relogio.hoje,
        diasComS1: doSetorChamados
          .filter((x) => x.severidade === 'S1')
          .map((x) => x.abertoEm.toISOString().slice(0, 10)),
        filaS2,
        conexoes: seriePessoasPorDia(retratos, logins),
        metasNoAlvo: null,
        aceiteCoordenador: st.aceiteCoordenador,
        diasSemS1,
        diasConexoes,
      });
      const seguro = (n: number) => (n > 0 && n < 5 ? ('<5' as const) : n);
      return {
        codigo: st.codigo,
        nome: st.nome,
        onda: st.onda,
        situacao: st.situacao,
        papeis: [...(st.definicao?.papeis ?? [])],
        chaveLiberacao: st.chaveLiberacao,
        chaves: st.chaves.map((k) => ({ ...k })),
        conducao: st.conducao,
        aceiteCoordenador: st.aceiteCoordenador,
        datas: { ...st.datas },
        composicao: st.composicao.map((x) => ({ ...x })),
        pessoas: seguro(doSetor.length),
        treinados: seguro(treinados),
        comAcesso: seguro(comAcesso),
        parcela,
        migrado,
        gravado: st.gravado,
      };
    });
    const parcelas = publicoPorPapel(publico.porGrupo, {});
    return {
      estabelecimento: c.hospital,
      aguardandoPrimeiro: espera.aguardando,
      primeiro: this.primeiro.codigo,
      motivoAguardando: espera.motivo,
      setores: resultado,
      publico: {
        total: publico.total,
        parcelas: parcelas.map((p) => ({ papel: p.papel, nome: p.nome, usuarios: p.usuarios ?? 0 })),
        referencia: c.hospital === this.primeiro.codigo ? TOTAL_REFERENCIA_PUBLICO : null,
      },
      lotes: lotes.map((l) => ({
        id: l.id,
        setor: l.setor,
        alvoTipo: l.alvoTipo,
        alvo: l.alvo,
        incluidos: l.incluidos,
        fora: l.fora,
        conducao: l.conducao,
        situacao: l.situacao,
        aplicadoPor: l.aplicadoPor,
        aplicadoEm: l.aplicadoEm,
        recolhidoEm: l.recolhidoEm,
      })),
    };
  }

  async editarSetor(s: SessaoCadastro, codigo: string, corpo: unknown): Promise<{ ok: true }> {
    const p = esquemaEditarSetor.safeParse(corpo);
    if (!p.success) throw invalido('Revise a situação e a justificativa.', p.error.issues);
    const atual = (await this.setoresMontados(s.porta)).find((x) => x.codigo === codigo);
    if (!atual) throw new ErroProblema('nao-encontrado', 404, 'Setor não encontrado');
    if (!transicaoPermitida(atual.situacao, p.data.situacao))
      throw recusa(
        'Passagem não permitida',
        `De "${atual.situacao}" o setor só avança um passo (ou recua). Siga a ordem: homologação, treinamento, liberado, acompanhamento, migrado.`,
      );
    // DP-4: o segundo estabelecimento não libera setor antes de tudo pronto no primeiro.
    if (
      s.hospital !== this.primeiro.codigo &&
      ['liberado', 'acompanhamento', 'migrado'].includes(p.data.situacao)
    ) {
      const espera = this.espera(
        s.hospital,
        await this.setoresMontados({ rede: s.rede, hospital: this.primeiro.codigo }).catch(() => null),
      );
      if (espera.aguardando)
        throw recusa('Aguardando o ProntoCardio', espera.motivo ?? '', 'aguardando-primeiro');
    }
    await this.d.porta.gravarSgh(
      s.porta,
      this.trilhaDe(s, EVENTOS_AUDITAVEIS.coexistenciaSetorAlterado.codigo, `setor:${p.data.situacao}`, {
        tabela: 'SGH_CFG_COEX_SETOR',
        id: codigo,
        chave: p.data.justificativa.slice(0, 120),
      }),
      (g) =>
        g.gravarSetor(
          {
            codigo,
            nome: atual.nome,
            onda: atual.onda,
            situacao: p.data.situacao,
            chaveLiberacao:
              p.data.chaveLiberacao === undefined ? atual.chaveLiberacao : p.data.chaveLiberacao,
            conducao: p.data.conducao ?? atual.conducao,
            aceiteCoordenador: p.data.aceiteCoordenador ?? atual.aceiteCoordenador,
            colunaData: colunaDaSituacao(p.data.situacao),
            ...(p.data.composicao ? { composicao: p.data.composicao } : {}),
          },
          s.login,
        ),
    );
    return { ok: true };
  }

  // ── Pessoas (regra 1) ───────────────────────────────────────────────────────────────────────────────

  async pessoasPorSetor(
    s: SessaoCadastro,
    q: { setor?: string; termo?: string; pagina?: string },
  ): Promise<PaginaPessoas> {
    const c = s.porta;
    const [pessoas, setores, conclusoes, conexoes, chaves, relogio] = await Promise.all([
      this.pessoas(c),
      this.setoresMontados(c),
      this.d.porta.conclusoes(c),
      this.d.porta.conexoesOutro(c),
      this.d.porta.chaves(c),
      this.d.porta.relogio(c),
    ]);
    const validas = this.conclusoesValidas(conclusoes);
    const ligadas = new Set(
      chaves.filter((k) => k.escopo === 'pessoa' && k.ligada === true).map((k) => k.valor.toUpperCase()),
    );
    const ultimas = new Map<string, Date[]>();
    for (const x of conexoes)
      ultimas.set(x.login.toUpperCase(), [...(ultimas.get(x.login.toUpperCase()) ?? []), x.ultima]);
    const termo = (q.termo ?? '').trim().toUpperCase();
    const itens = pessoas
      .map((p) => {
        const papel = papelDoGrupo(p.grupo);
        const doSetor = setores.filter((st) => pessoaNoSetor({ ...p, ativo: true }, this.setorDoLote(st)));
        const u = ultimas.get(p.login.toUpperCase()) ?? [];
        const maior = u.length ? u.reduce((m, d) => (d > m ? d : m)) : null;
        return {
          login: p.login,
          nome: p.nome,
          grupo: p.grupo,
          papel,
          setores: doSetor.map((x) => x.codigo),
          trilhaConcluida: doSetor.some((st) =>
            validas.some(
              (x) =>
                x.login.toUpperCase() === p.login.toUpperCase() &&
                x.papel === papel &&
                x.onda === st.onda &&
                x.resultado === 'aprovado',
            ),
          ),
          acessoNovo: ligadas.has(p.login.toUpperCase()),
          ultimoUsoNovo: null as string | null,
          ultimaConexaoOutro: maior ? maior.toISOString().slice(0, 16).replace('T', ' ') : null,
          diasSemOutro: diasDesdeUltimaConexao(u, relogio.hoje, FUSO_BANCO),
        };
      })
      .filter(
        (p) =>
          (!q.setor || p.setores.includes(q.setor)) &&
          (!termo || p.login.toUpperCase().includes(termo) || p.grupo?.toUpperCase().includes(termo)),
      );
    const pagina = Math.max(1, Number(q.pagina) || 1);
    const tamanho = 50;
    const daPagina = itens.slice((pagina - 1) * tamanho, pagina * tamanho);
    // O último uso no novo (SGH_TRILHA), só dos logins da página.
    const usos = new Map(
      (
        await this.d.porta.ultimoUsoNovo(
          c,
          daPagina.map((p) => p.login),
          somarDias(relogio.hoje, -DIAS_ULTIMO_USO_NOVO),
        )
      ).map((x) => [x.login.toUpperCase(), x.dia]),
    );
    for (const p of daPagina) p.ultimoUsoNovo = usos.get(p.login.toUpperCase()) ?? null;
    // A leitura da lista por pessoa vai à trilha (ficha, seção 4).
    await this.d.trilha.registrar({
      evento: EVENTOS_AUDITAVEIS.coexistenciaPessoasConsultadas.codigo,
      rede: s.rede,
      hospital: s.hospital,
      usuario: s.login,
      ...this.origem(s, 'coex-pessoas'),
      recurso: 'config.coexistencia.pessoas',
      resultado: 'sucesso',
      chaveNaturalAlvo: `setor:${q.setor ?? '*'}:${itens.length}`,
    });
    return { total: itens.length, pagina, itens: daPagina };
  }

  // ── Treinamento (regras 3 e 4) ──────────────────────────────────────────────────────────────────────

  private trilhaDoCatalogo(papel: PapelTreinamento, onda: number) {
    const def = PAPEIS.find((p) => p.id === papel);
    const tarefas = TAREFAS_TREINAMENTO.filter((t) => t.papel === papel && t.onda === onda);
    return { def, tarefas };
  }

  async treino(s: SessaoCadastro): Promise<PainelTreino> {
    const c = s.porta;
    const [gravadas, conclusoes] = await Promise.all([this.d.porta.trilhas(c), this.d.porta.conclusoes(c)]);
    const pares = new Map<string, { papel: PapelTreinamento; onda: number }>();
    for (const t of TAREFAS_TREINAMENTO) pares.set(`${t.papel}|${t.onda}`, { papel: t.papel, onda: t.onda });
    for (const g of gravadas)
      if ((PAPEIS_TREINAMENTO as readonly string[]).includes(g.papel))
        pares.set(`${g.papel}|${g.onda}`, { papel: g.papel as PapelTreinamento, onda: g.onda });
    const trilhas: TrilhaCoex[] = [];
    for (const { papel, onda } of [...pares.values()].sort(
      (a, b) => a.onda - b.onda || a.papel.localeCompare(b.papel),
    )) {
      const { def, tarefas } = this.trilhaDoCatalogo(papel, onda);
      const versoes = gravadas
        .filter((g) => g.papel === papel && g.onda === onda)
        .sort((a, b) => b.versao - a.versao);
      // W0-09: a versão retirada não vale mais (fica na lista de versões, com a história).
      const ativas = versoes.filter((v) => v.situacao !== 'retirada');
      const vigente = ativas.find((v) => v.situacao === 'vigente') ?? ativas[0];
      const ids = vigente ? vigente.tarefas : tarefas.map((t) => t.id);
      trilhas.push({
        papel,
        onda,
        versao: vigente?.versao ?? 1,
        nome: vigente?.nome ?? `${def?.nome ?? papel} — onda ${onda}`,
        carga: vigente?.carga ?? def?.cargaHoraria ?? 'conforme o papel',
        tarefas: ids.map((id) => {
          const t = TAREFAS_TREINAMENTO.find((x) => x.id === id);
          return {
            id,
            titulo: t?.titulo ?? id,
            // A rota da API que serve o material gerado (a tela abre pelo link).
            guia: `/api/${ROTA_GUIAS}/${papel}/${id}/guia`,
            video: `/api/${ROTA_GUIAS}/${papel}/${id}/video`,
            // Guia de versão anterior: a tarefa saiu da trilha publicada ou a versão não é a vigente (regra 4).
            desatualizada: !t || (vigente ? vigente.situacao !== 'vigente' : false),
          };
        }),
        exercicio:
          vigente?.exercicio ??
          'Exercício prático no ambiente de treino com o paciente sintético da turma, inclusive "como continuar no outro sistema se o novo parar".',
        situacao: vigente?.situacao === 'desatualizada' ? 'desatualizada' : 'vigente',
        publicada: !!vigente,
        publicadaEm: vigente?.publicadaEm ?? null,
        concluidas: conclusoes.filter(
          (x) => x.papel === papel && x.onda === onda && x.resultado === 'aprovado',
        ).length,
        versoes: versoes.map((v) => ({
          versao: v.versao,
          situacao:
            v.situacao === 'retirada' ? 'retirada' : v.situacao === 'vigente' ? 'vigente' : 'desatualizada',
          publicadaEm: v.publicadaEm,
          conclusoes: conclusoes.filter((x) => x.papel === papel && x.onda === onda && x.versao === v.versao)
            .length,
        })),
      });
    }
    const turmas = new Map<string, { turma: string; papel: string; onda: number; pessoas: Set<string> }>();
    for (const x of conclusoes) {
      const k = `${x.turma}|${x.papel}|${x.onda}`;
      const t = turmas.get(k) ?? { turma: x.turma, papel: x.papel, onda: x.onda, pessoas: new Set<string>() };
      t.pessoas.add(x.login);
      turmas.set(k, t);
    }
    return {
      estabelecimento: c.hospital,
      trilhas,
      turmas: [...turmas.values()].map((t) => ({
        turma: t.turma,
        papel: t.papel,
        onda: t.onda,
        pessoas: t.pessoas.size,
      })),
      porTurno: concluidasPorTurno(conclusoes),
      conclusoes: conclusoes
        .filter((x) => (PAPEIS_TREINAMENTO as readonly string[]).includes(x.papel))
        .slice(-500)
        .reverse()
        .map((x) => ({
          ...x,
          papel: x.papel as PapelTreinamento,
          turno: (TURNOS_TREINO as readonly string[]).includes(x.turno ?? '')
            ? (x.turno as TurnoTreino)
            : null,
        })),
      ambienteTreino: this.d.metodoMascaramento
        ? {
            metodoRegistrado: true,
            motivo: `Método de mascaramento registrado: ${this.d.metodoMascaramento}.`,
          }
        : {
            metodoRegistrado: false,
            motivo:
              'O ambiente de treino abre quando o dono registrar o método de mascaramento (DP-41). Até lá, o treino é sobre massa sintética.',
          },
    };
  }

  /** O guia (ou o roteiro de vídeo) de uma tarefa da trilha, lido da pasta gerada por `pnpm treinamento:gerar`. */
  guia(_s: SessaoCadastro, papel: string, tarefa: string, tipo: string): GuiaTreino {
    const t = TAREFAS_TREINAMENTO.find((x) => x.papel === papel && x.id === tarefa);
    if (!t || !(TIPOS_GUIA_TREINO as readonly string[]).includes(tipo) || !this.d.raizTreinamento)
      throw new ErroProblema('nao-encontrado', 404, 'Guia não encontrado');
    // Só nomes do catálogo (papel e tarefa conferidos acima): nenhum caminho vem de fora.
    const arquivo = join(this.d.raizTreinamento, t.papel, `${t.id}.${tipo}.md`);
    if (!existsSync(arquivo))
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Guia ainda não gerado',
        'O material desta tarefa ainda não foi gerado (pnpm treinamento:gerar).',
      );
    return {
      papel: t.papel,
      tarefa: t.id,
      tipo: tipo as GuiaTreino['tipo'],
      titulo: t.titulo,
      texto: readFileSync(arquivo, 'utf8'),
    };
  }

  async publicarTrilha(
    s: SessaoCadastro,
    papel: string,
    onda: string,
    corpo: unknown,
  ): Promise<{ versao: number }> {
    if (!(PAPEIS_TREINAMENTO as readonly string[]).includes(papel))
      throw new ErroProblema('nao-encontrado', 404, 'Papel não encontrado');
    const n = Number(onda);
    if (!Number.isInteger(n) || n < 0 || n > 5) throw invalido('Onda inválida.');
    const p = esquemaPublicarTrilha.safeParse(corpo);
    if (!p.success) throw invalido('Descreva o exercício prático (10 caracteres ou mais).', p.error.issues);
    const { def, tarefas } = this.trilhaDoCatalogo(papel as PapelTreinamento, n);
    if (tarefas.length === 0)
      throw recusa(
        'Trilha sem tarefas',
        'Não há jornadas de treinamento deste papel nesta onda (pnpm treinamento:gerar).',
      );
    return this.d.porta.gravarSgh(
      s.porta,
      (r: { versao: number }) =>
        this.trilhaDe(s, EVENTOS_AUDITAVEIS.coexistenciaTrilhaPublicada.codigo, `trilha:${papel}:${n}`, {
          tabela: 'SGH_CFG_COEX_TRILHA',
          id: `${papel}:${n}:${r.versao}`,
        }),
      (g) =>
        g.publicarTrilha(
          {
            papel,
            onda: n,
            nome: `${def?.nome ?? papel} — onda ${n}`,
            carga: p.data.carga ?? def?.cargaHoraria ?? 'conforme o papel',
            tarefas: tarefas.map((t) => t.id),
            exercicio: p.data.exercicio,
          },
          s.login,
        ),
    );
  }

  async registrarConclusao(
    s: SessaoCadastro,
    corpo: unknown,
  ): Promise<{ registradas: number; naoEncontrados: string[] }> {
    const p = esquemaRegistrarConclusao.safeParse(corpo);
    if (!p.success) throw invalido('Revise a turma, a data e as pessoas.', p.error.issues);
    const c = s.porta;
    const [pessoas, trilhas] = await Promise.all([this.pessoas(c), this.d.porta.trilhas(c)]);
    const vigente = trilhas
      .filter((t) => t.papel === p.data.papel && t.onda === p.data.onda)
      .sort((a, b) => b.versao - a.versao)
      .find((t) => t.situacao === 'vigente');
    if (!vigente)
      throw recusa(
        'Trilha não publicada',
        'Publique a versão da trilha deste papel e onda antes de registrar a conclusão.',
        'trilha-nao-publicada',
      );
    const porLogin = new Map(pessoas.map((x) => [x.login.toUpperCase(), x]));
    const achadas = [...new Set(p.data.logins.map((l) => l.trim().toUpperCase()))]
      .map((l) => porLogin.get(l))
      .filter((x): x is PessoaCoexLida => !!x);
    const naoEncontrados = p.data.logins.filter((l) => !porLogin.has(l.trim().toUpperCase()));
    if (achadas.some((x) => x.login.toUpperCase() === s.login.toUpperCase()))
      throw recusa(
        'Conclusão da própria pessoa',
        'Ninguém registra a própria conclusão do treinamento (segregação de funções).',
        'a-si-mesmo',
      );
    if (achadas.length === 0)
      throw recusa('Ninguém encontrado', 'Nenhum dos logins está ativo no estabelecimento.');
    const r = await this.d.porta.gravarSgh(
      c,
      this.trilhaDe(s, EVENTOS_AUDITAVEIS.coexistenciaTreinoRegistrado.codigo, `treino:${p.data.resultado}`, {
        tabela: 'SGH_CFG_COEX_TREINO',
        chave: `${p.data.papel}:${p.data.onda}:${vigente.versao}:${achadas.length}`,
      }),
      (g) =>
        g.registrarConclusoes(
          {
            pessoas: achadas.map((x) => ({ id: x.id, login: x.login })),
            papel: p.data.papel,
            onda: p.data.onda,
            versao: vigente.versao,
            turma: p.data.turma,
            turno: p.data.turno ?? null,
            concluidoEm: p.data.concluidoEm,
            resultado: p.data.resultado,
          },
          s.login,
        ),
    );
    return { registradas: r.registradas, naoEncontrados };
  }

  // ── Indicadores (cap-15 §15.3.4) ────────────────────────────────────────────────────────────────────

  async indicadores(s: SessaoCadastro, dias = 14): Promise<PainelIndicadores> {
    const c = s.porta;
    const relogio = await this.d.porta.relogio(c);
    const desde = somarDias(relogio.hoje, -(Math.min(Math.max(dias, 1), 90) - 1));
    const [uso, aoVivo, chamados, carga] = await Promise.all([
      this.d.porta.usoDia(c, desde),
      this.d.porta.usoAoVivo(c, relogio.hoje).catch(() => []),
      this.d.porta.chamados(c, { desde }),
      this.d.porta.carga(c),
    ]);
    const parcela = [
      ...uso
        .filter((u) => !u.operacao.startsWith('tarefa:'))
        .map((u) => ({
          dia: u.dia,
          setor: u.setor,
          operacao: u.operacao,
          parcela: calcularParcela(u.noNovo + u.noLegado, u.noNovo),
        })),
      ...aoVivo
        .filter((v) => !uso.some((u) => u.dia === relogio.hoje && u.operacao === v.operacao))
        .map((v) => ({
          dia: relogio.hoje,
          setor: v.setor,
          operacao: v.operacao,
          parcela: calcularParcela(v.linhasDoDia, v.doNovo),
        })),
    ];
    // Só as amostras deste estabelecimento (o medidor guarda por rede e hospital).
    const hojeTarefas = this.medidor.doDia(c);
    const tempo = [
      ...uso
        .filter((u) => u.operacao.startsWith('tarefa:') && u.dia !== relogio.hoje)
        .map((u) => ({ dia: u.dia, tarefa: u.operacao.slice(7), p50Ms: u.p50Ms, p95Ms: u.p95Ms })),
      ...hojeTarefas.map((t) => ({ dia: relogio.hoje, tarefa: t.tarefa, p50Ms: t.p50Ms, p95Ms: t.p95Ms })),
    ];
    const porDia = new Map<string, { colisoes: number; esperasTrava: number }>();
    for (const u of uso) {
      const x = porDia.get(u.dia) ?? { colisoes: 0, esperasTrava: 0 };
      x.colisoes += u.colisoes;
      x.esperasTrava += u.esperasTrava;
      porDia.set(u.dia, x);
    }
    const sev = ['S1', 'S2', 'S3', 'S4'] as const;
    const diasLista = Array.from(
      {
        length:
          Math.round((Date.parse(`${relogio.hoje}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / DIA) + 1,
      },
      (_, i) => somarDias(desde, i),
    );
    return {
      estabelecimento: c.hospital,
      dias: diasLista,
      parcela,
      tempo,
      colisoes: [...porDia.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([dia, x]) => ({ dia, ...x })),
      carga: {
        conexoesPorSistema: carga ? [...carga.conexoesPorSistema] : [],
        transacoesLongas: carga?.transacoesLongas ?? 0,
        consultasLentas: null,
        lidoEm: carga?.em ?? null,
      },
      chamados: sev.map((x) => {
        const d = chamados.filter((y) => y.severidade === x);
        const resolvidos = d.filter((y) => y.resolvidoEm);
        const horas = resolvidos.map((y) => (y.resolvidoEm!.getTime() - y.abertoEm.getTime()) / 3_600_000);
        return {
          severidade: x,
          abertos: d.filter((y) => !['resolvido', 'cancelado'].includes(y.situacao)).length,
          resolvidos: resolvidos.length,
          horasCorrecaoMedia: horas.length
            ? Math.round((horas.reduce((t, h) => t + h, 0) / horas.length) * 10) / 10
            : null,
        };
      }),
      grafana: this.d.grafana,
      disputa: disputaDosDias({
        hospital: c.hospital,
        dias: diasLista.filter((d) => d === relogio.hoje || uso.some((u) => u.dia === d)),
        hoje: relogio.hoje,
        uso,
        doProcesso: this.disputaPendenteDoProcesso(c.hospital, relogio.hoje),
        senhasHoje: this.senhasAoVivo(aoVivo),
      }),
    };
  }

  /** As contagens de disputa deste processo no dia (o executor do M04, por operação), desde a partida. */
  private disputaDoProcesso(hospital: string, dia: string): ContagemDisputa[] {
    return (this.d.metricas?.doDia(dia) ?? []).filter((x) => x.hospital === hospital);
  }

  /** O que este processo contou no dia e ainda não somou no banco (o painel soma ao gravado). */
  private disputaPendenteDoProcesso(hospital: string, dia: string): ContagemDisputa[] {
    return disputaPendente(this.disputaDoProcesso(hospital, dia), this.disputaGravada.get(dia) ?? new Map());
  }

  private senhasAoVivo(
    aoVivo: readonly { operacao: string; linhasDoDia: number; doNovo: number }[],
  ): { operacao: string; noNovo: number; noLegado: number } | null {
    const v = aoVivo.find((x) => x.operacao === 'recepcao.chamarSenha');
    if (!v) return null;
    const p = calcularParcela(v.linhasDoDia, v.doNovo);
    return { operacao: v.operacao, noNovo: p.novo, noLegado: p.legado };
  }

  // ── Onda 1 (M39): a lista para ligar o setor (regra 1) e os indicadores de disputa ──────────────────────

  /** A avaliação da lista para ligar um setor da onda 1 no estabelecimento (as operações pelo catálogo, regra 6). */
  private async avaliarOnda1(s: SessaoCadastro, setor: (typeof SETORES_ONDA_1)[number]) {
    const c = s.porta;
    const [itens, espera] = await Promise.all([this.d.porta.itensLigar(c), this.esperaDoPrimeiro(s)]);
    // O estado efetivo (regra 6 do M36: a reexecução com diferença rebaixa); catálogo ilegível: tudo bloqueado.
    const fonte = this.fonteCatalogo;
    const estados = Object.fromEntries(
      OPERACOES_FICHA_ONDA_1.flatMap((o) => o.catalogo).map((n) => [n, fonte.estado(n, c.hospital)]),
    ) as Record<string, ReturnType<typeof estadoEm>>;
    const doSetor = itens.filter((i) => i.setor === setor);
    return {
      avaliacao: avaliarLigarSetor({
        setor,
        hospital: c.hospital,
        estados,
        itens: doSetor.map((i): ItemLigar => ({
          item: i.item as ItemLigar['item'],
          situacao: i.situacao as ItemLigar['situacao'],
          evidencia: i.evidencia,
          em: i.em,
        })),
        ondasProntasNoPrimeiro: !espera.aguardando,
        bloqueio: null,
      }),
      registrados: doSetor,
    };
  }

  private async esperaDoPrimeiro(s: SessaoCadastro): Promise<{ aguardando: boolean; motivo: string | null }> {
    if (s.hospital === this.primeiro.codigo) return { aguardando: false, motivo: null };
    return this.espera(
      s.hospital,
      await this.setoresMontados({ rede: s.rede, hospital: this.primeiro.codigo }).catch(() => null),
    );
  }

  async painelOnda1(s: SessaoCadastro): Promise<PainelOnda1> {
    const c = s.porta;
    const relogio = await this.d.porta.relogio(c);
    const [uso, aoVivo] = await Promise.all([
      this.d.porta.usoDia(c, relogio.hoje),
      this.d.porta.usoAoVivo(c, relogio.hoje).catch(() => []),
    ]);
    const avaliacoes = [];
    for (const setor of SETORES_ONDA_1) {
      const { avaliacao, registrados } = await this.avaliarOnda1(s, setor);
      avaliacoes.push({
        ...avaliacao,
        nome: SETORES_PRONTIDAO.find((x) => x.id === setor)?.nome ?? setor,
        registrados: registrados.map((r) => ({
          item: r.item as ItemLigar['item'],
          situacao: r.situacao as ItemLigar['situacao'],
          evidencia: r.evidencia,
          em: r.em,
          alteradoPor: r.alteradoPor,
          alteradoEm: r.alteradoEm,
        })),
      });
    }
    const [disputa] = disputaDosDias({
      hospital: c.hospital,
      dias: [relogio.hoje],
      hoje: relogio.hoje,
      uso,
      doProcesso: this.disputaPendenteDoProcesso(c.hospital, relogio.hoje),
      senhasHoje: this.senhasAoVivo(aoVivo),
    });
    return {
      estabelecimento: c.hospital,
      primeiro: this.primeiro.codigo,
      avaliacoes,
      disputa: disputa!,
      telas: TELAS_ONDA_1.map((t) => ({
        tela: t.tela,
        item: t.item,
        setor: t.setor,
        ler: [...t.ler],
        agir: [...t.agir],
      })),
    };
  }

  /** Grava itens da lista para ligar um setor da onda 1 (só SGH_, com a trilha na mesma transação). */
  async gravarItensLigar(s: SessaoCadastro, setor: string, corpo: unknown): Promise<{ gravados: number }> {
    if (!ehSetorOnda1(setor)) throw new ErroProblema('nao-encontrado', 404, 'Setor fora da onda 1');
    const p = esquemaGravarItensLigar.safeParse(corpo);
    if (!p.success) throw invalido('Revise os itens, a evidência, a data e a justificativa.', p.error.issues);
    const itens = p.data.itens.map((i) => ({
      item: i.item,
      situacao: i.situacao,
      evidencia: i.evidencia,
      em: i.situacao === 'pendente' ? null : i.em,
    }));
    const trilha = {
      ...this.trilhaDe(
        s,
        EVENTOS_AUDITAVEIS.coexistenciaListaLigarAlterada.codigo,
        `ligar:${setor}:${itens.length}`.slice(0, 80),
        { tabela: 'SGH_CFG_COEX_LIGAR', id: null, chave: p.data.justificativa.slice(0, 120) },
      ),
    };
    return this.d.porta.gravarSgh(s.porta, trilha, (g) => g.gravarItensLigar(setor, itens, s.login));
  }

  // ── Onda 2 (M40): o critério de liberação por setor (regra 1 e as condições da onda) e o acompanhamento ──────

  /**
   * Os nomes do catálogo de operações; catálogo ilegível: as da ficha (o estado delas vem bloqueado pela fonte do
   * catálogo, e o critério falha fechado).
   */
  private nomesOperacoes(): string[] {
    try {
      return this.catalogo().operacoes.map((o) => o.nome);
    } catch {
      return [
        ...OPERACOES_CATALOGO_ONDA_2,
        ...OPERACOES_CATALOGO_ONDA_3,
        ...SETORES_ONDA_4.flatMap((x) => x.operacoes),
      ];
    }
  }

  /** O pentest (M36) para o critério: sem o painel da homologação, bloqueia (falha fechada). */
  private pentestOnda2(): { bloqueia: boolean; motivo: string } {
    const p = this.d.homologacao?.painel()?.pentest;
    if (!p)
      return { bloqueia: true, motivo: 'situação do teste de invasão não gerada (painel da homologação)' };
    if (!p.bloqueiaLiberacao) return { bloqueia: false, motivo: 'sem achado crítico ou alto aberto' };
    return {
      bloqueia: true,
      motivo:
        p.abertosCriticosOuAltos > 0
          ? `teste de invasão com ${p.abertosCriticosOuAltos} achado(s) crítico(s) ou alto(s) aberto(s)`
          : `teste de invasão ainda não liberado (situação: ${p.situacao})`,
    };
  }

  /** A avaliação do critério de um setor da onda 2 no estabelecimento (as operações pelo estado efetivo, regra 6). */
  private avaliarOnda2(
    hospital: string,
    setor: string,
    itens: readonly { setor: string; item: string; situacao: string; evidencia: string; em: string | null }[],
    nomesCatalogo: readonly string[],
    pentest: { bloqueia: boolean; motivo: string },
  ) {
    const def = SETORES_PRONTIDAO.find((x) => x.id === setor)!;
    const fonte = this.fonteCatalogo;
    // O catálogo só é relido quando há operação bloqueada (para saber se ela já foi conferida no hospital).
    let lido: { cat: CatalogoOperacoes | null } | null = null;
    const catalogo = (): CatalogoOperacoes | null => {
      if (!lido) {
        try {
          lido = { cat: this.catalogo() };
        } catch {
          lido = { cat: null };
        }
      }
      return lido.cat;
    };
    const operacoes = operacoesDoSetor(def, nomesCatalogo).map((nome) => {
      const estado = fonte.estado(nome, hospital) ?? 'especificada';
      // A bloqueada que já foi conferida no hospital (recolhida) ou que divergiu na reexecução (motivo do estado
      // efetivo) segura o setor; sem o catálogo legível, também (falha fechada).
      const cat = estado === 'bloqueada' ? catalogo() : null;
      const regrediu =
        estado === 'bloqueada' &&
        (cat === null ||
          (fonte.motivo?.(nome, hospital) ?? null) !== null ||
          (cat.operacoes
            .find((o) => o.nome === nome)
            ?.conferencias.some((x) => x.estabelecimento === hospital) ??
            false));
      return { nome, estado, fora: operacaoForaDaOnda(estado, regrediu) };
    });
    const registrados: ItemCriterioRegistrado[] = itens
      .filter((i) => i.setor === setor)
      .map((i) => ({
        item: i.item as ItemCriterioRegistrado['item'],
        situacao: i.situacao as ItemCriterioRegistrado['situacao'],
        evidencia: i.evidencia,
        em: i.em,
      }));
    const avaliacao = avaliarLiberacaoSetor({
      setor: def,
      operacoes: Object.fromEntries(operacoes.filter((o) => !o.fora).map((o) => [o.nome, o.estado])),
      itens: registrados,
      pentest,
      fora: operacoes.filter((o) => o.fora).map((o) => o.nome),
    });
    return { def, operacoes, avaliacao };
  }

  /**
   * M40 (regras 1 e 2), para a tela "Chaves de liberação": o que falta para ligar a chave de um setor da onda 2 (null:
   * pode ligar, ou a chave não é da onda 2). Uma chave usada por mais de um setor da onda (uma operação ou um recurso
   * compartilhado) liga quando ao menos um desses setores tem o critério completo: é a liberação desse setor; as
   * pessoas dos outros só a recebem pelo lote do setor delas, que confere o próprio critério (D-CHAVE-40).
   */
  async motivoLigarChaveOnda2(
    c: { rede: string; hospital: string },
    tipo: 'recurso' | 'operacao',
    chave: string,
  ): Promise<string | null> {
    const nomes = this.nomesOperacoes();
    // M41: a chave de um setor da onda 3 passa pelo mesmo critério (o avaliador é o mesmo da onda 2).
    // M42: e a de um setor da onda 4, com a regra 1 da onda (início na abertura da competência) reavaliada.
    const doisOuTres = setoresOnda2DaChave(tipo, chave, nomes);
    const ate3 = doisOuTres.length ? doisOuTres : setoresOnda3DaChave(tipo, chave, nomes);
    const setores = ate3.length ? ate3 : setoresOnda4DaChave(tipo, chave, nomes);
    if (setores.length === 0) return null;
    const itens = await this.d.porta.itensLigar(c);
    const pentest = this.pentestOnda2();
    const feriados = setores.some(ehSetorOnda4) ? await this.feriados(c) : new Set<string>();
    const faltas: string[] = [];
    for (const setor of setores) {
      const { def, avaliacao } = ehSetorOnda4(setor)
        ? this.avaliarOnda4(c.hospital, setor, itens, nomes, pentest, feriados)
        : this.avaliarOnda2(c.hospital, setor, itens, nomes, pentest);
      const m = motivoLoteOnda2(avaliacao);
      if (!m) return null;
      faltas.push(`${def.nome}: ${m}`);
    }
    return faltas.join(' ');
  }

  async painelOnda2(s: SessaoCadastro): Promise<PainelOnda2> {
    const c = s.porta;
    const [itens, relogio, doPrimeiro] = await Promise.all([
      this.d.porta.itensLigar(c),
      this.d.porta.relogio(c),
      s.hospital === this.primeiro.codigo
        ? Promise.resolve(null)
        : this.setoresMontados({ rede: s.rede, hospital: this.primeiro.codigo }).catch(() => null),
    ]);
    const nomes = this.nomesOperacoes();
    const pentest = this.pentestOnda2();
    const setores = SETORES_ONDA_2.map((setor) => {
      const { def, operacoes, avaliacao } = this.avaliarOnda2(c.hospital, setor, itens, nomes, pentest);
      const liberadas = operacoes.filter((o) => o.estado === 'liberada').map((o) => o.nome);
      return {
        setor,
        nome: def.nome,
        passo: passoDoSetorOnda2(setor),
        podeLiberar: avaliacao.podeLiberar,
        itens: avaliacao.itens.map((i) => ({ ...i })),
        registrados: itens
          .filter((i) => i.setor === setor)
          .map((r) => ({
            item: r.item,
            situacao: r.situacao as ItemCriterioRegistrado['situacao'],
            evidencia: r.evidencia,
            em: r.em,
            alteradoPor: r.alteradoPor,
            alteradoEm: r.alteradoEm,
          })),
        operacoes,
        recursosSoNoNovo: recursosSoNoNovoDoSetor(def).map((chave) => ({
          chave,
          imprime: RECURSOS_SO_NO_NOVO[chave] ?? chave,
        })),
        recolhimento: (({ chaves, bloquear }) => ({ chaves: [...chaves], bloquear: [...bloquear] }))(
          planoRecolhimento(def, liberadas),
        ),
      };
    });
    // Regra 8: no outro hospital, os setores do primeiro que ainda não estão prontos (sem leitura: todos seguram).
    const situacoes = Object.fromEntries((doPrimeiro ?? []).map((x) => [x.codigo, x.situacao]));
    const seguramHospital =
      s.hospital !== this.primeiro.codigo && doPrimeiro === null
        ? SETORES_PRONTIDAO.filter((x) => x.onda >= 1).map((x) => x.id)
        : setoresQueSeguramHospital(s.hospital === this.primeiro.codigo ? 'pc' : s.hospital, situacoes);
    const v = versaoPermitida(relogio.hoje, null);
    return {
      estabelecimento: c.hospital,
      primeiro: this.primeiro.codigo,
      seguramHospital,
      ordem: ORDEM_SETORES_ONDA_2.map((p) => [...p]),
      setores,
      pentest,
      versao: {
        hoje: relogio.hoje,
        permitida: v.permitida,
        motivo: v.motivo,
        janelas: JANELAS_SEM_VERSAO_PADRAO.map((j) => ({ ...j })),
      },
      codigosAConfirmar: CODIGOS_BAIXA_CONFIANCA_ONDA_2.map((x) => ({ ...x, vistos: [...x.vistos] })),
    };
  }

  // ── Onda 3 (M41): o critério por setor da farmácia, do almoxarifado e das compras, sobre as regras do M40 ───────

  async painelOnda3(s: SessaoCadastro): Promise<PainelMigracaoOnda3> {
    const c = s.porta;
    const [itens, montados, doPrimeiro, regra1] = await Promise.all([
      this.d.porta.itensLigar(c),
      this.setoresMontados(c).catch(() => [] as SetorMontado[]),
      s.hospital === this.primeiro.codigo
        ? Promise.resolve(null)
        : this.setoresMontados({ rede: s.rede, hospital: this.primeiro.codigo }).catch(() => null),
      this.d.criterio?.mapaRegra1 ? this.d.criterio.mapaRegra1(c).catch(() => null) : Promise.resolve(null),
    ]);
    const nomes = this.nomesOperacoes();
    const pentest = this.pentestOnda2();
    const situacoes = Object.fromEntries(montados.map((x) => [x.codigo, x.situacao]));
    const setores = SETORES_ONDA_3.map((setor) => {
      const { def, operacoes, avaliacao } = this.avaliarOnda2(c.hospital, setor, itens, nomes, pentest);
      const liberadas = operacoes.filter((o) => o.estado === 'liberada').map((o) => o.nome);
      return {
        setor,
        nome: def.nome,
        passo: passoDoSetorOnda3(setor),
        podeLiberar: avaliacao.podeLiberar,
        itens: avaliacao.itens.map((i) => ({ ...i })),
        registrados: itens
          .filter((i) => i.setor === setor)
          .map((r) => ({
            item: r.item,
            situacao: r.situacao as ItemCriterioRegistrado['situacao'],
            evidencia: r.evidencia,
            em: r.em,
            alteradoPor: r.alteradoPor,
            alteradoEm: r.alteradoEm,
          })),
        operacoes: operacoes.map((o) => ({ ...o, prioridade: prioridadeOnda3(o.nome) ?? 'P2' })),
        antesFaltam: anterioresNaoLiberados(setor, situacoes),
        exigePrescricao: itensDoSetor(def).includes('prescricao-na-unidade'),
        recursosSoNoNovo: def.recursos
          .filter((r) => r in RECURSOS_SO_NO_NOVO_ONDA_3)
          .map((chave) => ({ chave, imprime: RECURSOS_SO_NO_NOVO_ONDA_3[chave] ?? chave })),
        recolhimento: (({ chaves, bloquear }) => ({ chaves: [...chaves], bloquear: [...bloquear] }))(
          planoRecolhimento(def, liberadas),
        ),
      };
    });
    const sit1 = Object.fromEntries((doPrimeiro ?? []).map((x) => [x.codigo, x.situacao]));
    const seguramHospital =
      s.hospital !== this.primeiro.codigo && doPrimeiro === null
        ? SETORES_PRONTIDAO.filter((x) => x.onda >= 1).map((x) => x.id)
        : setoresQueSeguramHospital(s.hospital === this.primeiro.codigo ? 'pc' : s.hospital, sit1);
    return esquemaPainelMigracaoOnda3.parse({
      estabelecimento: c.hospital,
      primeiro: this.primeiro.codigo,
      seguramHospital,
      ordem: ORDEM_SETORES_ONDA_3.map((p) => [...p]),
      setores,
      pentest,
      regra1: regra1
        ? {
            lido: regra1.lido,
            locais: regra1.locais.map((l) => ({ ...l, unidades: [...l.unidades], faltam: [...l.faltam] })),
            unidadesComPrescricao: [...regra1.unidadesComPrescricao],
          }
        : { lido: false, locais: [], unidadesComPrescricao: [] },
      foraDaOnda: RECURSOS_FORA_DA_ONDA3.map((chave) => ({ chave, motivo: MOTIVO_FORA_DA_ONDA3[chave] })),
      codigosAConfirmar: CODIGOS_BAIXA_CONFIANCA_ONDA_3.map((x) => ({ ...x, vistos: [...x.vistos] })),
    });
  }

  /** Grava itens do critério de um setor da onda 3 (os itens do setor; só SGH_, com a trilha na mesma transação). */
  async gravarItensOnda3(s: SessaoCadastro, setor: string, corpo: unknown): Promise<{ gravados: number }> {
    if (!ehSetorOnda3(setor)) throw new ErroProblema('nao-encontrado', 404, 'Setor fora da onda 3');
    const p = esquemaGravarItensOnda2.safeParse(corpo);
    if (!p.success) throw invalido('Revise os itens, a evidência, a data e a justificativa.', p.error.issues);
    const def = SETORES_PRONTIDAO.find((x) => x.id === setor)!;
    const doSetor = itensDoSetor(def);
    const fora = p.data.itens.filter((i) => !doSetor.includes(i.item));
    if (fora.length) throw invalido(`Item fora do critério do setor: ${fora.map((i) => i.item).join(', ')}.`);
    const itens = p.data.itens.map((i) => ({
      item: i.item,
      situacao: i.situacao,
      evidencia: i.evidencia,
      em: i.situacao === 'pendente' ? null : i.em,
    }));
    const trilha = this.trilhaDe(
      s,
      EVENTOS_AUDITAVEIS.coexistenciaListaLigarAlterada.codigo,
      `criterio:${setor}:${itens.length}`.slice(0, 80),
      { tabela: 'SGH_CFG_COEX_LIGAR', id: null, chave: p.data.justificativa.slice(0, 120) },
    );
    return this.d.porta.gravarSgh(s.porta, trilha, (g) => g.gravarItensLigar(setor, itens, s.login));
  }

  // ── Onda 4 (M42): o critério por setor do faturamento, do financeiro e do repasse, sobre as regras do M40 ───────

  private vistosLidos: { v: DominiosVistos | null } | null = null;
  /** Domínios vistos do perfil (regra 9: os valores já gravados no banco; ilegível, a lista sai vazia). */
  private dominiosVistos(): DominiosVistos | null {
    if (!this.vistosLidos) {
      try {
        // A raiz do repositório (a API em produção e o dev) ou a pasta do app (os testes da API).
        const raiz = [process.cwd(), join(process.cwd(), '../..')]
          .map((r) => join(r, 'packages/legado/src'))
          .find((p) => existsSync(p));
        this.vistosLidos = { v: raiz ? carregarDominiosVistos(raiz) : null };
      } catch {
        this.vistosLidos = { v: null };
      }
    }
    return this.vistosLidos.v;
  }

  /**
   * Feriados da regra 1 (M42, D-FER-42): os nacionais de lei (padrão de mercado, POL-1) de 2000 a 2100 somados aos do
   * cadastro de feriados do estabelecimento (ilegível: só os nacionais). O parâmetro do adicional de feriado do repasse
   * não entra: tem outro dono e outro efeito.
   */
  private async feriados(c: ContextoCoex): Promise<ReadonlySet<string>> {
    const r = new Set<string>();
    for (let ano = 2000; ano <= 2100; ano++) for (const d of feriadosNacionais(ano)) r.add(d);
    const locais = await (
      this.d.porta.feriados?.(c, '2000-01-01', '2100-12-31') ?? Promise.resolve([])
    ).catch(() => [] as string[]);
    for (const d of locais) r.add(d);
    return r;
  }

  /** A avaliação da onda 2 com a regra 1 da onda 4 reavaliada (o início registrado fora da abertura segura o setor). */
  private avaliarOnda4(
    hospital: string,
    setor: string,
    itens: readonly { setor: string; item: string; situacao: string; evidencia: string; em: string | null }[],
    nomesCatalogo: readonly string[],
    pentest: { bloqueia: boolean; motivo: string },
    feriados: ReadonlySet<string>,
  ) {
    const r = this.avaliarOnda2(hospital, setor, itens, nomesCatalogo, pentest);
    const doSetor = itens
      .filter((i) => i.setor === setor)
      .map((i) => ({
        item: i.item as ItemCriterioRegistrado['item'],
        situacao: i.situacao as ItemCriterioRegistrado['situacao'],
        em: i.em,
      }));
    return { ...r, avaliacao: ajustarAberturaOnda4(r.avaliacao, doSetor, feriados) };
  }

  /** As situações das respostas (regra 8); ilegíveis: nenhuma lida (vale o padrão de mercado; a parte não para). */
  private respostasLidas(): SituacaoRespostaLida[] {
    const raiz = this.d.raizRespostas;
    if (!raiz) return [];
    return ['faturamento.md', 'fiscal.md'].flatMap((f) => {
      try {
        return lerSituacoesRespostas(readFileSync(join(raiz, f), 'utf8'));
      } catch {
        return [];
      }
    });
  }

  async painelOnda4(s: SessaoCadastro): Promise<PainelMigracaoOnda4> {
    const c = s.porta;
    const [itens, montados, doPrimeiro, relogio, feriados] = await Promise.all([
      this.d.porta.itensLigar(c),
      this.setoresMontados(c).catch(() => [] as SetorMontado[]),
      s.hospital === this.primeiro.codigo
        ? Promise.resolve(null)
        : this.setoresMontados({ rede: s.rede, hospital: this.primeiro.codigo }).catch(() => null),
      this.d.porta.relogio(c),
      this.feriados(c),
    ]);
    const nomes = this.nomesOperacoes();
    const pentest = this.pentestOnda2();
    const situacoes = Object.fromEntries(montados.map((x) => [x.codigo, x.situacao]));
    const respostas = this.respostasLidas();
    const setores = SETORES_ONDA_4_PRONTIDAO.map((setor) => {
      const { def, operacoes, avaliacao } = this.avaliarOnda4(
        c.hospital,
        setor,
        itens,
        nomes,
        pentest,
        feriados,
      );
      const liberadas = operacoes.filter((o) => o.estado === 'liberada').map((o) => o.nome);
      const momento = momentoDoSetorOnda4(setor)!;
      const anteriores = ORDEM_SETORES_ONDA_4.slice(0, passoDoSetorOnda4(setor) - 1).flat();
      return {
        setor,
        nome: def.nome,
        passo: passoDoSetorOnda4(setor),
        momento,
        momentoRotulo: ROTULO_MOMENTO_ONDA_4[momento],
        podeLiberar: avaliacao.podeLiberar,
        itens: avaliacao.itens.map((i) => ({ ...i })),
        registrados: itens
          .filter((i) => i.setor === setor)
          .map((r) => ({
            item: r.item,
            situacao: r.situacao as ItemCriterioRegistrado['situacao'],
            evidencia: r.evidencia,
            em: r.em,
            alteradoPor: r.alteradoPor,
            alteradoEm: r.alteradoEm,
          })),
        operacoes: operacoes.map((o) => ({ ...o })),
        antesFaltam: anteriores.filter(
          (a) => !['liberado', 'acompanhamento', 'migrado'].includes(situacoes[a] ?? ''),
        ),
        exigeAbertura: setorExigeAbertura(setor),
        respostas: respostasDoSetorOnda4(setor, respostas, s.hospital),
        recursosSoNoNovo: def.recursos
          .filter((r) => r in RECURSOS_SO_NO_NOVO_ONDA_4)
          .map((chave) => ({ chave, imprime: RECURSOS_SO_NO_NOVO_ONDA_4[chave] ?? chave })),
        recolhimento: (({ chaves, bloquear }) => ({ chaves: [...chaves], bloquear: [...bloquear] }))(
          planoRecolhimento(def, liberadas),
        ),
      };
    });
    const sit1 = Object.fromEntries((doPrimeiro ?? []).map((x) => [x.codigo, x.situacao]));
    const seguramHospital =
      s.hospital !== this.primeiro.codigo && doPrimeiro === null
        ? SETORES_PRONTIDAO.filter((x) => x.onda >= 1).map((x) => x.id)
        : setoresQueSeguramHospital(s.hospital === this.primeiro.codigo ? 'pc' : s.hospital, sit1);
    const hoje = relogio.hoje;
    const ab = conferirAberturaDaCompetencia(hoje, feriados);
    const [ano, mes] = [Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7))];
    const dias = diasDeFechamento(ano, mes, feriados, FECHAMENTO_PADRAO);
    const vistos = this.dominiosVistos();
    return esquemaPainelMigracaoOnda4.parse({
      estabelecimento: c.hospital,
      primeiro: this.primeiro.codigo,
      seguramHospital,
      ordem: ORDEM_SETORES_ONDA_4.map((p) => [...p]),
      setores,
      pentest,
      abertura: {
        hoje,
        competencia: ab.competencia,
        abertura: ab.abertura,
        proximaAbertura: ab.proximaAbertura,
        hojeEhAbertura: ab.ok,
      },
      semVersao: {
        dias: [...dias],
        hojeSemVersao: dias.includes(hoje),
        motivo: 'fechamento da competência: só correção de defeito grave (S1) nestes dias',
      },
      saidasExternas: SAIDAS_EXTERNAS_ONDA_4.map((x) => ({
        ...x,
        permitida: saidaExternaPermitida(this.d.ambiente, null),
      })),
      sus: { fora: [...ENVIOS_SUS_FORA_DA_ONDA], operacoesSus: operacoesSusNaOnda4() },
      codigosAConfirmar: CODIGOS_BAIXA_CONFIANCA_ONDA_4.map((x) => {
        const [tabela = '', coluna = ''] = x.coluna.split('.');
        return {
          coluna: x.coluna,
          dp: x.dp,
          pergunta: x.pergunta,
          citados: [...x.citados],
          vistos: [...(vistos?.vistos(tabela, coluna) ?? [])].sort(),
        };
      }),
      catalogos: {
        operacoes: [...(SETORES_ONDA_4.find((x) => x.id === 'catalogos-de-preco')?.operacoes ?? [])],
        motivo:
          'a carga dos catálogos de preço só passa a este sistema com o contrato de conteúdo (DP-36); até lá, segue pelo sistema anterior',
      },
    });
  }

  /** Grava itens do critério de um setor da onda 4 (os itens do setor; regra 1 na data do início; trilha junto). */
  async gravarItensOnda4(s: SessaoCadastro, setor: string, corpo: unknown): Promise<{ gravados: number }> {
    if (!ehSetorOnda4(setor)) throw new ErroProblema('nao-encontrado', 404, 'Setor fora da onda 4');
    const p = esquemaGravarItensOnda2.safeParse(corpo);
    if (!p.success) throw invalido('Revise os itens, a evidência, a data e a justificativa.', p.error.issues);
    const def = SETORES_PRONTIDAO.find((x) => x.id === setor)!;
    const doSetor = itensDoSetor(def);
    const fora = p.data.itens.filter((i) => !doSetor.includes(i.item));
    if (fora.length) throw invalido(`Item fora do critério do setor: ${fora.map((i) => i.item).join(', ')}.`);
    const motivo = motivoForaDaAbertura(p.data.itens, await this.feriados(s.porta));
    if (motivo)
      throw new ErroProblema('recusa-de-negocio', 409, 'Fora da abertura da competência', motivo, {
        codigo: CODIGO_FORA_DA_ABERTURA,
      });
    const itens = p.data.itens.map((i) => ({
      item: i.item,
      situacao: i.situacao,
      evidencia: i.evidencia,
      em: i.situacao === 'pendente' ? null : i.em,
    }));
    const trilha = this.trilhaDe(
      s,
      EVENTOS_AUDITAVEIS.coexistenciaListaLigarAlterada.codigo,
      `criterio:${setor}:${itens.length}`.slice(0, 80),
      { tabela: 'SGH_CFG_COEX_LIGAR', id: null, chave: p.data.justificativa.slice(0, 120) },
    );
    return this.d.porta.gravarSgh(s.porta, trilha, (g) => g.gravarItensLigar(setor, itens, s.login));
  }

  /** Grava itens do critério de um setor da onda 2 (só SGH_, com a trilha na mesma transação). */
  async gravarItensOnda2(s: SessaoCadastro, setor: string, corpo: unknown): Promise<{ gravados: number }> {
    if (!ehSetorOnda2(setor)) throw new ErroProblema('nao-encontrado', 404, 'Setor fora da onda 2');
    const p = esquemaGravarItensOnda2.safeParse(corpo);
    if (!p.success) throw invalido('Revise os itens, a evidência, a data e a justificativa.', p.error.issues);
    const itens = p.data.itens.map((i) => ({
      item: i.item,
      situacao: i.situacao,
      evidencia: i.evidencia,
      em: i.situacao === 'pendente' ? null : i.em,
    }));
    const trilha = this.trilhaDe(
      s,
      EVENTOS_AUDITAVEIS.coexistenciaListaLigarAlterada.codigo,
      `criterio:${setor}:${itens.length}`.slice(0, 80),
      { tabela: 'SGH_CFG_COEX_LIGAR', id: null, chave: p.data.justificativa.slice(0, 120) },
    );
    return this.d.porta.gravarSgh(s.porta, trilha, (g) => g.gravarItensLigar(setor, itens, s.login));
  }

  /** Acompanhamento da onda 2 (campo 4): só agregados por dia e unidade, guardados por 1 h. */
  async acompanhamentoOnda2(s: SessaoCadastro, consulta: unknown): Promise<AcompanhamentoOnda2> {
    const c = s.porta;
    let pedido: { de: string; ate: string };
    if (!consulta || (typeof consulta === 'object' && !('de' in consulta) && !('ate' in consulta))) {
      const { hoje } = await this.d.porta.relogio(c);
      pedido = { de: somarDias(hoje, -6), ate: hoje };
    } else {
      const p = esquemaConsultaAcompanhamento.safeParse(consulta);
      if (!p.success) throw invalido('Período inválido (AAAA-MM-DD, até 62 dias).', p.error.issues);
      pedido = p.data;
    }
    const carregar = () => this.d.porta.acompanhamentoOnda2(c, pedido.de, pedido.ate);
    const lido =
      !this.d.cache || this.d.porta.destino === 'memoria'
        ? await carregar()
        : await this.d.cache.lerOuCarregar(
            this.d.cache.chave(c.rede, c.hospital, 'coex-onda2', `${pedido.de}:${pedido.ate}`),
            TTL_ACOMPANHAMENTO_S,
            carregar,
          );
    return {
      estabelecimento: c.hospital,
      de: pedido.de,
      ate: pedido.ate,
      checagem: indicadorChecagem(lido.checagem),
      higienizacao: indicadorHigienizacao(lido.higienizacao),
      registros: registrosPorSistema(lido.registros.totais, lido.registros.peloNovo),
    };
  }

  /** O dia corrente das tarefas-chave e das parcelas em SGH_CFG_COEX_USO_DIA (o processo da API; fora de dev/ci). */
  async gravarDiaCorrente(c: ContextoCoex): Promise<number> {
    const relogio = await this.d.porta.relogio(c);
    const aoVivo = await this.d.porta.usoAoVivo(c, relogio.hoje);
    // M39 (revisão): a disputa do dia contada pelo executor deste processo vai junto, como INCREMENTO: só o que ele
    // contou desde o último retrato bem-sucedido (o banco soma; reinicialização e outro processo não perdem nada).
    const total = this.disputaDoProcesso(c.hospital, relogio.hoje);
    const disputa = this.disputaPendenteDoProcesso(c.hospital, relogio.hoje);
    const disputaDe = (operacao: string) => {
      const x = disputa.find((d) => d.operacao === operacao);
      return x
        ? {
            colisoes: x.conflitosVersao + x.travas,
            esperasTrava: x.travas,
            recusasOcupado: x.recusasPorCodigo['horario-ocupado'] ?? 0,
          }
        : {};
    };
    const linhas = [
      ...aoVivo.map((v) => {
        const p = calcularParcela(v.linhasDoDia, v.doNovo);
        return {
          dia: relogio.hoje,
          setor: v.setor,
          operacao: v.operacao,
          noNovo: p.novo,
          noLegado: p.legado,
          ...disputaDe(v.operacao),
        };
      }),
      // As operações com disputa no dia e sem medida de parcela (cancelar, encaixar, chamar…): só a disputa.
      ...disputa
        .filter((d) => !aoVivo.some((v) => v.operacao === d.operacao))
        .map((d) => ({
          dia: relogio.hoje,
          setor: setorDaOperacaoOnda1(d.operacao),
          operacao: d.operacao,
          noNovo: 0,
          noLegado: 0,
          ...disputaDe(d.operacao),
        }))
        .filter((x) => x.setor !== null)
        .map((x) => ({ ...x, setor: x.setor! })),
      ...this.medidor
        .doDia(c)
        .filter((t) => t.amostras > 0)
        .map((t) => ({
          dia: relogio.hoje,
          setor: '*',
          operacao: `tarefa:${t.tarefa}`,
          noNovo: t.amostras,
          noLegado: 0,
          p50Ms: t.p50Ms,
          p95Ms: t.p95Ms,
        })),
    ];
    if (linhas.length === 0) return 0;
    const trilha: LinhaTrilha = {
      rede: c.rede,
      hospital: c.hospital,
      usuario: 'sgh.api',
      evento: EVENTOS_AUDITAVEIS.coexistenciaRetratoGravado.codigo,
      recurso: 'config.coexistencia',
      operacao: 'uso-dia',
      tabelaAlvo: 'SGH_CFG_COEX_USO_DIA',
      idAlvo: relogio.hoje,
      chaveNaturalAlvo: `linhas:${linhas.length}`,
      resultado: 'sucesso',
      estacao: 'api',
      correlacao: `coex-uso-${Date.now()}`,
    };
    const gravadas = (await this.d.porta.gravarSgh(c, trilha, (g) => g.gravarUsoDia(linhas))).gravadas;
    // Só depois do COMMIT: o total contado passa a ser o já somado (uma falha manda o incremento de novo depois).
    const ja = this.disputaGravada.get(relogio.hoje) ?? new Map<string, ContagemDisputa>();
    for (const t of total) ja.set(`${t.hospital}|${t.operacao}`, t);
    for (const dia of this.disputaGravada.keys()) if (dia !== relogio.hoje) this.disputaGravada.delete(dia);
    this.disputaGravada.set(relogio.hoje, ja);
    return gravadas;
  }

  // ── Lote de liberação (regra 3a) ────────────────────────────────────────────────────────────────────

  async aplicarLote(
    s: SessaoCadastro,
    corpo: unknown,
    ctx?: () => Promise<ContextoOperacao>,
  ): Promise<ResultadoLoteCoex> {
    const p = esquemaPedidoLoteCoex.safeParse(corpo);
    if (!p.success)
      throw invalido('Escolha o setor, o alvo e justifique (10 caracteres ou mais).', p.error.issues);
    const c = s.porta;
    const setor = (await this.setoresMontados(c)).find((x) => x.codigo === p.data.setor);
    if (!setor) throw new ErroProblema('nao-encontrado', 404, 'Setor não encontrado');
    if (setor.chaves.length === 0)
      throw recusa(
        'Setor sem chave',
        'O setor não tem funcionalidade nem chave própria: grave a chave de liberação do setor antes do lote.',
        'setor-sem-chave',
      );
    if (this.d.ambiente === 'producao' && !p.data.referenciaAutorizacao)
      throw invalido('Em produção, o lote exige a linha de autorização do dono (ESTADO.md › Autorizações).');
    if (this.d.ambiente === 'producao') {
      const cat = this.catalogo();
      for (const k of setor.chaves.filter((x) => x.tipo === 'operacao')) {
        const op = cat.operacoes.find((o) => o.nome === k.chave);
        if (!op || estadoEm(op, s.hospital) !== 'liberada')
          throw recusa(
            'Operação não liberada',
            `Em produção, só liga operação liberada no catálogo (${k.chave}).`,
            'operacao-bloqueada',
          );
      }
    }
    if (s.hospital !== this.primeiro.codigo) {
      const espera = this.espera(
        s.hospital,
        await this.setoresMontados({ rede: s.rede, hospital: this.primeiro.codigo }).catch(() => null),
      );
      if (espera.aguardando)
        throw recusa('Aguardando o ProntoCardio', espera.motivo ?? '', 'aguardando-primeiro');
    }
    // M39, regra 1: o lote de um setor da onda 1 só com a lista para ligar completa. Fora de dev/ci (homologação,
    // treino, produção), recusa; em dev/ci (massa sintética), o lote segue e a resposta traz o que falta (D-LIGAR-39).
    let avisoLigar: string | null = null;
    if (ehSetorOnda1(setor.codigo)) {
      avisoLigar = motivoLoteOnda1((await this.avaliarOnda1(s, setor.codigo)).avaliacao);
      if (avisoLigar && !['dev', 'ci'].includes(this.d.ambiente))
        throw recusa('Lista para ligar incompleta', avisoLigar, CODIGO_LISTA_LIGAR_INCOMPLETA);
    }
    // M40, regra 1: o lote de um setor da onda 2 só com o critério completo (a mesma política da onda 1).
    if (ehSetorOnda2(setor.codigo)) {
      const itens = await this.d.porta.itensLigar(c);
      const { avaliacao } = this.avaliarOnda2(
        c.hospital,
        setor.codigo,
        itens,
        this.nomesOperacoes(),
        this.pentestOnda2(),
      );
      avisoLigar = motivoLoteOnda2(avaliacao);
      if (avisoLigar && !['dev', 'ci'].includes(this.d.ambiente))
        throw recusa('Critério de liberação incompleto', avisoLigar, CODIGO_CRITERIO_ONDA_2_INCOMPLETO);
    }
    // M41: o lote de um setor da onda 3 só com o critério completo (a mesma política das ondas 1 e 2).
    if (ehSetorOnda3(setor.codigo)) {
      const itens = await this.d.porta.itensLigar(c);
      const { avaliacao } = this.avaliarOnda2(
        c.hospital,
        setor.codigo,
        itens,
        this.nomesOperacoes(),
        this.pentestOnda2(),
      );
      avisoLigar = motivoLoteOnda2(avaliacao);
      if (avisoLigar && !['dev', 'ci'].includes(this.d.ambiente))
        throw recusa('Critério de liberação incompleto', avisoLigar, CODIGO_CRITERIO_ONDA_3_INCOMPLETO);
    }
    // M42: o lote de um setor da onda 4 só com o critério completo, com a regra 1 da onda (início na abertura).
    if (ehSetorOnda4(setor.codigo)) {
      const itens = await this.d.porta.itensLigar(c);
      const { avaliacao } = this.avaliarOnda4(
        c.hospital,
        setor.codigo,
        itens,
        this.nomesOperacoes(),
        this.pentestOnda2(),
        await this.feriados(c),
      );
      avisoLigar = motivoLoteOnda2(avaliacao);
      if (avisoLigar && !['dev', 'ci'].includes(this.d.ambiente))
        throw recusa('Critério de liberação incompleto', avisoLigar, CODIGO_CRITERIO_ONDA_4_INCOMPLETO);
    }
    // M41, regra 1 da onda 3 (todo ambiente): o lote que liga a dispensação ou a entrega exige a prescrição eletrônica
    // em uso nas unidades atendidas, como a tela de chaves (sem o avaliador do estoque, falha fechada).
    const daRegra1 = setor.chaves.find((k) => chaveExigePrescricao(k.chave));
    if (daRegra1) {
      const avaliar = this.d.criterio?.regraFarmacia;
      const m = avaliar
        ? await avaliar(c, daRegra1.tipo, daRegra1.chave)
        : 'a regra da farmácia (prescrição eletrônica em uso nas unidades atendidas) não pôde ser conferida agora.';
      if (m) throw recusa('Prescrição eletrônica ainda não em uso', m, CODIGO_FARMACIA_SEM_PRESCRICAO);
    }
    const [pessoas, conclusoes] = await Promise.all([this.pessoas(c), this.d.porta.conclusoes(c)]);
    const plano = planejarLoteCoexistencia(
      p.data.alvo,
      pessoas.map((x) => ({ ...x, ativo: true })),
      this.setorDoLote(setor),
      this.conclusoesValidas(conclusoes),
    );
    if (plano.incluidos.length === 0)
      throw recusa(
        'Ninguém para liberar',
        `Nenhuma pessoa do alvo cumpre a regra (setor liberado e trilha concluída). Fora: ${plano.fora
          .slice(0, 5)
          .map((f) => `${f.login} (${f.motivo})`)
          .join('; ')}.`,
        'lote-vazio',
      );
    // Regra 3a e 6: setor com a condução ligada leva no lote as retiradas dos pares propostos (os com gente fora do
    // setor só com a decisão do gestor). Conferido ANTES de gravar qualquer coisa.
    const planoConducao = setor.conducao ? await this.planoConducaoDoLote(s, setor.codigo, p.data) : null;
    const alvo = p.data.alvo.tipo === 'setor' ? setor.codigo : p.data.alvo.valores.join(',');
    const trilha = {
      rede: s.rede,
      hospital: s.hospital,
      usuario: s.login,
      evento: EVENTOS_AUDITAVEIS.coexistenciaLoteAplicado.codigo,
      recurso: 'config.coexistencia',
      operacao: `lote:${setor.codigo}`,
      chaveNaturalAlvo: `${setor.codigo}:${plano.incluidos.length}`,
      resultado: 'sucesso',
      ...this.origem(s, 'coex-lote'),
    };
    const r = await this.d.porta
      .aplicarLote(
        c,
        {
          setor: setor.codigo,
          alvoTipo: p.data.alvo.tipo,
          alvo,
          chaves: setor.chaves,
          incluidos: plano.incluidos,
          fora: plano.fora,
          justificativa: p.data.justificativa,
          autorizacao: p.data.referenciaAutorizacao ?? null,
          autor: s.login,
          conducao: (planoConducao?.porGrupo.size ?? 0) > 0,
          conferir: (k, estado) => {
            const rec = k.tipo === 'recurso' ? recursoDesligado(k.chave) : undefined;
            if (rec) {
              const dec = decidirChave(true, rec.prerequisitos, estado.prerequisitos, new Date());
              if (!dec.permitido)
                throw recusa(
                  'Pré-requisito pendente',
                  `${k.chave}: ${dec.mensagem}`,
                  'prerequisito-pendente',
                );
            }
          },
          planejar: (_k, estado) => planejarLote(estado.chaves, 'pessoa', plano.incluidos, true),
        },
        trilha,
      )
      .catch((e: unknown) => {
        if (e instanceof ErroProblema) throw e;
        throw new ErroProblema('indisponivel', 503, 'O lote não foi gravado', 'Nada mudou. Tente de novo.');
      });
    await this.d.cache?.invalidar(s.rede, s.hospital, ['liberacao'], Date.now());
    let conducao: ResultadoLoteCoex['conducao'] = null;
    if (planoConducao && planoConducao.porGrupo.size > 0) {
      if (!ctx || !this.d.administracao)
        throw new ErroProblema('indisponivel', 503, 'Permissões indisponíveis');
      const c = await ctx();
      const autorizacao = p.data.referenciaAutorizacao!;
      const feitos: [string, number[]][] = [];
      try {
        for (const [grupo, opcoes] of planoConducao.porGrupo) {
          await this.conduzir('retirar', s, c, setor.codigo, grupo, opcoes, autorizacao, r.id);
          feitos.push([grupo, opcoes]);
        }
      } catch (e) {
        // Compensação: o lote é uma unidade. Devolve os grupos já retirados e recolhe as chaves; nada fica pela metade.
        await this.compensarLote(s, c, setor.codigo, r, feitos, autorizacao);
        if (e instanceof ErroProblema && e.getStatus() < 500) throw e;
        throw new ErroProblema(
          'indisponivel',
          503,
          'O lote não foi aplicado',
          'A retirada de uma opção do grupo falhou: o que já tinha sido feito foi desfeito. Tente de novo.',
        );
      }
      const feitas = feitos.reduce((t, [, o]) => t + o.length, 0);
      await this.d.trilha.registrar({
        evento: EVENTOS_AUDITAVEIS.coexistenciaConducaoAlterada.codigo,
        rede: s.rede,
        hospital: s.hospital,
        usuario: s.login,
        estacao: c.estacao ?? estacaoDaRequisicao(s.req).slice(0, 80),
        correlacao: c.traceId.slice(0, 64),
        recurso: 'config.coexistencia',
        resultado: 'sucesso',
        chaveNaturalAlvo: `lote:${r.id}:retirar:${setor.codigo}:${feitas}`,
      });
      conducao = { feitas, grupos: feitos.map(([g]) => g), fora: planoConducao.fora };
    } else if (planoConducao) conducao = { feitas: 0, grupos: [], fora: planoConducao.fora };
    return {
      lote: r.id,
      incluidos: [...plano.incluidos],
      fora: [...plano.fora],
      chaves: r.chaves,
      conducao,
      destino: this.d.porta.destino,
      avisoLigar,
    };
  }

  /** Os pares da condução que entram no lote do setor (os propostos; com gente fora do setor, só com decisão). */
  private async planoConducaoDoLote(
    s: SessaoCadastro,
    setor: string,
    pedido: { referenciaAutorizacao?: string | undefined; decisaoGestor?: readonly string[] | undefined },
  ): Promise<{ porGrupo: Map<string, number[]>; fora: { grupo: string; opcao: number; motivo: string }[] }> {
    if (!s.pode(PERMISSOES_M37.opcaoRevogar))
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Lote com a condução do setor',
        'Este setor usa a condução opcional: o lote retira opções dos grupos e precisa da permissão do gestor de acessos.',
      );
    if (!pedido.referenciaAutorizacao || pedido.referenciaAutorizacao.trim().length < 5)
      throw invalido(
        'Este setor usa a condução opcional: informe a autorização do dono para o setor (a linha em Autorizações).',
      );
    if (!this.d.administracao) throw new ErroProblema('indisponivel', 503, 'Permissões indisponíveis');
    const painel = await this.conducao(s, setor);
    const decididos = new Set((pedido.decisaoGestor ?? []).map((d) => d.trim().toUpperCase()));
    const escolhidos = painel.pares.filter(
      (x) => x.situacao === 'proposta' && (!x.exigeDecisao || decididos.has(chavePar(x.grupo, x.opcao))),
    );
    const conf = conferirRetirada(
      escolhidos.map((x) => ({ grupo: x.grupo, opcao: x.opcao })),
      painel.pares,
      [...decididos],
    );
    if (!conf.ok) throw recusa('Condução recusada', conf.motivo, 'conducao-recusada');
    return {
      porGrupo: conf.porGrupo,
      fora: painel.pares
        .filter(
          (x) => x.situacao === 'proposta' && x.exigeDecisao && !decididos.has(chavePar(x.grupo, x.opcao)),
        )
        .map((x) => ({
          grupo: x.grupo,
          opcao: x.opcao,
          motivo: `${x.usuariosFora} usuário(s) do grupo fora do setor: precisa da decisão do gestor de acessos`,
        })),
    };
  }

  /** Uma retirada (ou devolução) de opções do grupo pela operação do protocolo, com o registro na mesma transação. */
  private async conduzir(
    acao: 'retirar' | 'devolver',
    s: SessaoCadastro,
    c: ContextoOperacao,
    setor: string,
    grupo: string,
    opcoes: readonly number[],
    autorizacao: string,
    lote?: string,
  ): Promise<void> {
    const conducao = { setor, autorizacao, ...(lote ? { lote } : {}) };
    await this.d.administracao!.executar(
      acao === 'retirar' ? 'acesso.revogarOpcoesGrupo' : 'acesso.concederOpcoesGrupo',
      { grupo, opcoes: [...opcoes], conducao },
      { ...c, idempotencyKey: `${c.idempotencyKey}:${acao}:${grupo}`.slice(0, 120) },
    );
    this.d.porta.registrarConducaoMemoria?.(s.porta, acao, {
      ...conducao,
      grupo,
      opcoes,
      usuario: s.login,
    });
  }

  /** Desfaz um lote que falhou na condução: devolve os grupos já retirados e recolhe as chaves do lote. */
  private async compensarLote(
    s: SessaoCadastro,
    c: ContextoOperacao,
    setor: string,
    r: { id: string; chaves: { tipo: string; chave: string; loteLiberacao: string }[] },
    feitos: readonly [string, number[]][],
    autorizacao: string,
  ): Promise<void> {
    for (const [grupo, opcoes] of feitos)
      await this.conduzir('devolver', s, c, setor, grupo, opcoes, autorizacao).catch(() => undefined);
    await this.d.porta
      .recolherLote(
        s.porta,
        {
          id: r.id,
          justificativa: 'compensação: a condução do lote falhou',
          autor: s.login,
          chaves: r.chaves.map((k) => ({
            tipo: k.tipo === 'recurso' ? 'recurso' : 'operacao',
            chave: k.chave,
            loteLiberacao: k.loteLiberacao,
          })),
        },
        {
          rede: s.rede,
          hospital: s.hospital,
          usuario: s.login,
          evento: EVENTOS_AUDITAVEIS.coexistenciaLoteRecolhido.codigo,
          recurso: 'config.coexistencia',
          operacao: `recolher:${setor}`,
          chaveNaturalAlvo: `lote:${r.id}:compensacao`,
          resultado: 'sucesso',
          ...this.origem(s, 'coex-recolher'),
        },
      )
      .catch(() => undefined);
    await this.d.cache?.invalidar(s.rede, s.hospital, ['liberacao'], Date.now());
  }

  async recolherLote(
    s: SessaoCadastro,
    id: string,
    corpo: unknown,
    ctx?: () => Promise<ContextoOperacao>,
  ): Promise<{ recolhido: boolean; alteradas: number; devolvidas: number }> {
    if (!/^\d{1,20}$/.test(id)) throw new ErroProblema('nao-encontrado', 404, 'Lote não encontrado');
    const p = esquemaRecolherLote.safeParse(corpo);
    if (!p.success) throw invalido('Justifique o recolhimento (10 caracteres ou mais).', p.error.issues);
    const [lote] = await this.d.porta.lotes(s.porta, id);
    if (!lote) throw new ErroProblema('nao-encontrado', 404, 'Lote não encontrado');
    if (lote.situacao !== 'aplicado')
      throw recusa('Lote já recolhido', 'Este lote já foi recolhido.', 'lote-recolhido');
    // Regra 3a: o lote com condução volta inteiro. Primeiro as opções voltam aos grupos (pela operação do protocolo,
    // uma por grupo); se uma falhar, o lote continua "aplicado" e o recolhimento seguinte devolve só o que falta.
    let devolvidas = 0;
    if (lote.conducao) {
      const retiradas = (await this.d.porta.conducoes(s.porta, lote.setor)).filter(
        (x) => x.lote === id && x.situacao === 'retirada',
      );
      if (retiradas.length > 0) {
        if (!s.pode(PERMISSOES_M37.opcaoConceder))
          throw new ErroProblema(
            'sem-permissao',
            403,
            'Lote com a condução do setor',
            'Este lote retirou opções dos grupos: recolhê-lo devolve as opções e precisa da permissão do gestor de acessos.',
          );
        if (!ctx || !this.d.administracao)
          throw new ErroProblema('indisponivel', 503, 'Permissões indisponíveis');
        const c = await ctx();
        const porGrupo = new Map<string, { opcoes: number[]; autorizacao: string }>();
        for (const x of retiradas) {
          const g = porGrupo.get(x.grupo) ?? { opcoes: [], autorizacao: x.autorizacao };
          if (!g.opcoes.includes(x.opcao)) g.opcoes.push(x.opcao);
          porGrupo.set(x.grupo, g);
        }
        for (const [grupo, g] of porGrupo) {
          await this.conduzir('devolver', s, c, lote.setor, grupo, g.opcoes, g.autorizacao).catch(
            (e: unknown) => {
              throw recusa(
                'Lote não recolhido',
                `A devolução das opções do grupo ${grupo} falhou (${e instanceof Error ? e.message : 'erro'}): o lote continua aplicado; recolha de novo para devolver o que falta.`,
                'lote-conducao-pendente',
              );
            },
          );
          devolvidas += g.opcoes.length;
        }
      }
    }
    const r = await this.d.porta
      .recolherLote(
        s.porta,
        { id, justificativa: p.data.justificativa, autor: s.login, chaves: lote.chaves },
        {
          rede: s.rede,
          hospital: s.hospital,
          usuario: s.login,
          evento: EVENTOS_AUDITAVEIS.coexistenciaLoteRecolhido.codigo,
          recurso: 'config.coexistencia',
          operacao: `recolher:${lote.setor}`,
          chaveNaturalAlvo: `lote:${id}`,
          resultado: 'sucesso',
          ...this.origem(s, 'coex-recolher'),
        },
      )
      .catch((e: unknown) => {
        if (e instanceof ErroProblema) throw e;
        throw recusa(
          'Lote não recolhido',
          e instanceof Error ? e.message : 'Nada mudou. Tente de novo.',
          'lote-alterado',
        );
      });
    await this.d.cache?.invalidar(s.rede, s.hospital, ['liberacao'], Date.now());
    return { ...r, devolvidas };
  }

  // ── Condução opcional (regra 6) ─────────────────────────────────────────────────────────────────────

  private gruposDoSetor(st: SetorMontado, pessoas: readonly PessoaCoexLida[]): string[] {
    const explicitos = st.composicao.filter((x) => x.tipo === 'grupo').map((x) => x.valor);
    if (explicitos.length) return explicitos;
    const sl = this.setorDoLote(st);
    return [
      ...new Set(
        pessoas.filter((p) => p.grupo && pessoaNoSetor({ ...p, ativo: true }, sl)).map((p) => p.grupo!),
      ),
    ];
  }

  async conducao(s: SessaoCadastro, setorCodigo: string): Promise<PainelConducao> {
    const c = s.porta;
    const setor = (await this.setoresMontados(c)).find((x) => x.codigo === setorCodigo);
    if (!setor) throw new ErroProblema('nao-encontrado', 404, 'Setor não encontrado');
    const pessoas = await this.pessoas(c);
    const grupos = this.gruposDoSetor(setor, pessoas);
    const cat = this.catalogo();
    const provadas = new Set(
      this.d.ambiente === 'producao' ? ['liberada'] : ['verde', 'conferida', 'liberada'],
    );
    const def = setor.definicao ?? SETORES_PRONTIDAO.find((x) => x.id === setorCodigo);
    const operacoes = def
      ? operacoesDoSetor(
          def,
          cat.operacoes.map((o) => o.nome),
        ).filter((n) => {
          const o = cat.operacoes.find((x) => x.nome === n);
          // Na memória (sessão sintética, estabelecimento sem estado no catálogo), todas as do setor.
          return o ? this.d.porta.destino === 'memoria' || provadas.has(estadoEm(o, s.hospital)) : false;
        })
      : [];
    const opcoes = opcoesDosModulos(new Set(operacoes.map((n) => n.split('.')[0] ?? '')));
    const sl = this.setorDoLote(setor);
    const usuarios: Record<string, { noSetor: number; fora: number }> = {};
    for (const p of pessoas) {
      if (!p.grupo) continue;
      const k = p.grupo.toUpperCase();
      const x = usuarios[k] ?? { noSetor: 0, fora: 0 };
      if (pessoaNoSetor({ ...p, ativo: true }, sl)) x.noSetor++;
      else x.fora++;
      usuarios[k] = x;
    }
    const [concessoes, retiradas] = await Promise.all([
      this.d.porta.opcoesDosGrupos(c, grupos),
      this.d.porta.conducoes(c, setorCodigo),
    ]);
    const pares = proporConducao(grupos, opcoes, concessoes, usuarios, retiradas);
    return {
      estabelecimento: c.hospital,
      setor: setorCodigo,
      conducaoLigada: setor.conducao,
      operacoes,
      pares,
      retiradas: retiradas.filter((x) => x.situacao === 'retirada').length,
    };
  }

  async retirar(
    s: SessaoCadastro,
    setorCodigo: string,
    corpo: unknown,
    ctx: () => Promise<ContextoOperacao>,
  ): Promise<ResultadoConducao> {
    const p = esquemaRetirarConducao.safeParse(corpo);
    if (!p.success)
      throw invalido('Escolha os pares e informe a autorização do dono para este setor.', p.error.issues);
    if (!this.d.administracao) throw new ErroProblema('indisponivel', 503, 'Permissões indisponíveis');
    const painel = await this.conducao(s, setorCodigo);
    if (!painel.conducaoLigada)
      throw recusa(
        'Condução desligada',
        'O setor não usa a condução opcional: ligue-a na situação do setor (com o pedido do setor ou a decisão do dono).',
        'conducao-desligada',
      );
    const conf = conferirRetirada(p.data.pares, painel.pares, p.data.decisaoGestor ?? []);
    if (!conf.ok) throw recusa('Retirada recusada', conf.motivo, 'conducao-recusada');
    const c = await ctx();
    const grupos: string[] = [];
    let feitas = 0;
    // Uma operação do protocolo por grupo (a retirada e o registro na mesma transação); a falha de um grupo para ali.
    for (const [grupo, opcoes] of conf.porGrupo) {
      await this.conduzir('retirar', s, c, setorCodigo, grupo, opcoes, p.data.autorizacao);
      grupos.push(grupo);
      feitas += opcoes.length;
    }
    await this.d.trilha.registrar({
      evento: EVENTOS_AUDITAVEIS.coexistenciaConducaoAlterada.codigo,
      rede: s.rede,
      hospital: s.hospital,
      usuario: s.login,
      estacao: c.estacao ?? estacaoDaRequisicao(s.req).slice(0, 80),
      correlacao: c.traceId.slice(0, 64),
      recurso: 'config.coexistencia',
      resultado: 'sucesso',
      chaveNaturalAlvo: `retirar:${setorCodigo}:${feitas}`,
    });
    return { feitas, grupos, destino: this.d.porta.destino };
  }

  async devolver(
    s: SessaoCadastro,
    setorCodigo: string,
    corpo: unknown,
    ctx: () => Promise<ContextoOperacao>,
  ): Promise<ResultadoConducao> {
    const p = esquemaDevolverConducao.safeParse(corpo ?? {});
    if (!p.success) throw invalido('Pedido inválido.', p.error.issues);
    if (!this.d.administracao) throw new ErroProblema('indisponivel', 503, 'Permissões indisponíveis');
    const retiradas = (await this.d.porta.conducoes(s.porta, setorCodigo)).filter(
      (x) => x.situacao === 'retirada' && (!p.data.ids?.length || p.data.ids.includes(x.id)),
    );
    if (retiradas.length === 0)
      throw recusa('Nada a devolver', 'Não há opção retirada deste setor.', 'nada-a-devolver');
    const porGrupo = new Map<string, { opcoes: number[]; autorizacao: string }>();
    for (const r of retiradas) {
      const x = porGrupo.get(r.grupo) ?? { opcoes: [], autorizacao: r.autorizacao };
      if (!x.opcoes.includes(r.opcao)) x.opcoes.push(r.opcao);
      porGrupo.set(r.grupo, x);
    }
    const c = await ctx();
    let feitas = 0;
    for (const [grupo, x] of porGrupo) {
      await this.conduzir('devolver', s, c, setorCodigo, grupo, x.opcoes, x.autorizacao);
      feitas += x.opcoes.length;
    }
    await this.d.trilha.registrar({
      evento: EVENTOS_AUDITAVEIS.coexistenciaConducaoAlterada.codigo,
      rede: s.rede,
      hospital: s.hospital,
      usuario: s.login,
      estacao: c.estacao ?? estacaoDaRequisicao(s.req).slice(0, 80),
      correlacao: c.traceId.slice(0, 64),
      recurso: 'config.coexistencia',
      resultado: 'sucesso',
      chaveNaturalAlvo: `devolver:${setorCodigo}:${feitas}`,
    });
    return { feitas, grupos: [...porGrupo.keys()], destino: this.d.porta.destino };
  }

  // ── Chamados (regra 7) ──────────────────────────────────────────────────────────────────────────────

  private chamadoLido(
    x: Awaited<ReturnType<PortaCoexistencia['chamados']>>[number],
    agora: Date,
  ): ChamadoLido {
    const prox = proximaAtualizacaoS1({
      severidade: x.severidade as 'S1',
      situacao: x.situacao,
      abertoEm: x.abertoEm,
      atualizadoEm: x.atualizadoEm,
    });
    const iso = (d: Date) => d.toISOString().slice(0, 16).replace('T', ' ');
    return {
      id: x.id,
      sistema: x.sistema as ChamadoLido['sistema'],
      severidade: x.severidade as ChamadoLido['severidade'],
      nivel: x.nivel as ChamadoLido['nivel'],
      situacao: x.situacao as ChamadoLido['situacao'],
      tela: x.tela,
      versao: x.versao,
      traceId: x.traceId,
      setor: x.setor,
      ocorridoEm: iso(x.ocorridoEm),
      prazoResposta: iso(x.prazoResposta),
      prazoSolucao: iso(x.prazoSolucao),
      vencido: chamadoVencido(
        {
          situacao: x.situacao,
          prazoResposta: x.prazoResposta,
          prazoContorno: x.prazoSolucao,
          respondidoEm: x.respondidoEm,
        },
        agora,
      ),
      comandante: x.comandante,
      dadoPessoal: x.dadoPessoal,
      encarregadoAvisado: x.encarregadoAvisado,
      descricao: x.descricao,
      contorno: x.contorno,
      abertoPor: x.abertoPor,
      abertoEm: iso(x.abertoEm),
      proximaAtualizacao: prox ? iso(prox) : null,
    };
  }

  async chamados(s: SessaoCadastro, consulta: unknown = {}): Promise<ListaChamados> {
    const q = esquemaFiltroChamados.safeParse(consulta ?? {});
    if (!q.success) throw invalido('Revise os filtros dos chamados.', q.error.issues);
    const relogio = await this.d.porta.relogio(s.porta);
    const pagina = q.data.pagina ?? 1;
    const filtro = {
      ...(q.data.severidade ? { severidade: q.data.severidade } : {}),
      ...(q.data.situacao ? { situacao: q.data.situacao } : {}),
      ...(q.data.sistema ? { sistema: q.data.sistema } : {}),
      ...(q.data.setor ? { setor: q.data.setor } : {}),
      ...(q.data.dias ? { desde: somarDias(relogio.hoje, -(q.data.dias - 1)) } : {}),
    };
    // A ordem da triagem (os não encerrados primeiro, por severidade e prazo) e a página vêm do banco.
    const [lidos, total, prazos] = await Promise.all([
      this.d.porta.chamados(s.porta, {
        ...filtro,
        ordem: 'triagem',
        limite: TAMANHO_PAGINA_CHAMADOS,
        pular: (pagina - 1) * TAMANHO_PAGINA_CHAMADOS,
      }),
      this.d.porta.contarChamados(s.porta, filtro),
      this.prazos(s.porta),
    ]);
    return {
      total,
      pagina,
      tamanho: TAMANHO_PAGINA_CHAMADOS,
      itens: lidos.map((x) => this.chamadoLido(x, relogio.agora)),
      prazos: prazos.prazos.map((p) => ({
        severidade: p.severidade,
        respostaMin: p.resposta,
        solucaoMin: p.contorno,
        diaUtil: p.diaUtil,
        aprovado: prazos.aprovado,
      })),
    };
  }

  async abrirChamado(
    s: SessaoCadastro,
    corpo: unknown,
    meta: { traceId: string | null; idUsuario: number | null },
  ): Promise<{ id: string; prazoResposta: string; aviso: string }> {
    const p = esquemaAbrirChamado.safeParse(corpo);
    if (!p.success)
      throw invalido(
        `Diga em que sistema aconteceu, a severidade e descreva (10 caracteres ou mais). ${AVISO_TEXTO_CHAMADO}`,
        p.error.issues,
      );
    const relogio = await this.d.porta.relogio(s.porta);
    const { prazos } = await this.prazos(s.porta);
    const pz = prazosDoChamado(p.data.severidade, relogio.agora, prazos, new Set(), FUSO_BANCO);
    const id = await this.d.porta.gravarSgh(
      s.porta,
      (x: string) =>
        this.trilhaDe(s, EVENTOS_AUDITAVEIS.chamadoAberto.codigo, `chamado:${p.data.severidade}`, {
          tabela: 'SGH_CFG_CHAMADO',
          id: x,
          chave: p.data.sistema,
        }),
      (g) =>
        g.abrirChamado(
          {
            sistema: p.data.sistema,
            severidade: p.data.severidade,
            tela: p.data.tela ?? null,
            versao: p.data.versao ?? null,
            ocorridoEm: relogio.agora,
            traceId: p.data.traceId ?? meta.traceId,
            setor: p.data.setor ?? null,
            prazoResposta: pz.resposta,
            prazoSolucao: pz.contorno,
            dadoPessoal: p.data.dadoPessoal,
            descricao: p.data.descricao,
            abertoPorId: meta.idUsuario,
            abertoPor: s.login,
          },
          { encarregado: p.data.dadoPessoal, s1: p.data.severidade === 'S1' },
        ),
    );
    return {
      id,
      prazoResposta: pz.resposta.toISOString().slice(0, 16).replace('T', ' '),
      aviso: AVISO_TEXTO_CHAMADO,
    };
  }

  async triarChamado(s: SessaoCadastro, id: string, corpo: unknown): Promise<ChamadoLido> {
    if (!/^\d{1,20}$/.test(id)) throw new ErroProblema('nao-encontrado', 404, 'Chamado não encontrado');
    const p = esquemaTriarChamado.safeParse(corpo);
    if (!p.success) throw invalido('Revise a severidade, a situação e o nível.', p.error.issues);
    const motivo = conferirTriagem({
      severidade: p.data.severidade,
      situacao: p.data.situacao,
      comandante: p.data.comandante ?? null,
    });
    if (motivo) throw recusa('Triagem recusada', motivo, 'sem-comandante');
    const [atual] = await this.d.porta.chamados(s.porta, { id });
    if (!atual) throw new ErroProblema('nao-encontrado', 404, 'Chamado não encontrado');
    const { prazos } = await this.prazos(s.porta);
    const pz =
      p.data.severidade === atual.severidade
        ? { resposta: atual.prazoResposta, contorno: atual.prazoSolucao }
        : prazosDoChamado(p.data.severidade, atual.abertoEm, prazos, new Set(), FUSO_BANCO);
    const n = await this.d.porta.gravarSgh(
      s.porta,
      this.trilhaDe(s, EVENTOS_AUDITAVEIS.chamadoTriado.codigo, `triar:${p.data.situacao}`, {
        tabela: 'SGH_CFG_CHAMADO',
        id,
        chave: `${p.data.severidade}:${p.data.nivel}`,
      }),
      (g) =>
        g.triarChamado(
          id,
          {
            severidade: p.data.severidade,
            situacao: p.data.situacao,
            nivel: p.data.nivel,
            comandante: p.data.comandante ?? null,
            contorno: p.data.contorno ?? null,
            prazoResposta: pz.resposta,
            prazoSolucao: pz.contorno,
          },
          s.login,
        ),
    );
    if (n !== 1)
      throw recusa('Chamado encerrado', 'O chamado já está resolvido ou cancelado.', 'chamado-encerrado');
    const [depois] = await this.d.porta.chamados(s.porta, { id });
    return this.chamadoLido(depois!, (await this.d.porta.relogio(s.porta)).agora);
  }

  /** Para o relatório e o teste: a contagem segura (abaixo de 5, "<5"). */
  static contagem(n: number): string {
    return contagemSegura(n);
  }

  /** Para o relatório: o par da decisão do gestor (GRUPO:opção). */
  static par(grupo: string, opcao: number): string {
    return chavePar(grupo, opcao);
  }
}
