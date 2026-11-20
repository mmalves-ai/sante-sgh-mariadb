// Porta das integrações sobre o núcleo do legado (M34): leituras READ ONLY pelos repositórios de @sgh/legado; gravações
// só em SGH_ com a SGH_TRILHA e o evento da SGH_OUTBOX na MESMA transação (regra 7: a transação que falha não deixa
// evento); o resultado conferido do laboratório de apoio pelo EXECUTOR (receita sadt.registrarResultado). Em dev sobre
// a cópia compartilhada, o executor só de leitura recusa a gravação no legado. `portaIntegracaoNaTransacao`: a mesma
// porta sobre UMA transação aberta (os testes de integração na cópia, sempre desfeita).
import {
  alterarParceiro,
  concluirRecebida,
  contagensDoMonitor,
  criarParceiro,
  deParaDoExameApoio,
  type Escritor,
  exameDoRetornoApoio,
  type Executor,
  fatosResultadoLiberado,
  type FonteCatalogo,
  gravarCredencial,
  gravarOutbox,
  gravarTrilha,
  identificacaoRnds,
  interfacesDeApoio,
  type Leitor,
  lerEnvio,
  lerEnvios,
  lerExameSadt,
  lerMarcaFato,
  lerMortos,
  lerParceiro,
  lerParceiros,
  lerRecebida,
  lerRecebidas,
  type MetricasExecutor,
  type NucleoLegado,
  operacao,
  registrarEnvio,
  registrarRecebida,
  relogioRecepcao,
  resumoDoSegredo,
  saudeIntegracoesLegado,
  tratarMorto,
  vinculosDoLogin,
  visoesDeParceiroExistentes,
  visoesDosParceiros,
} from '@sgh/legado';
import { portaIndisponivel } from '../exames/public-api.js';
import {
  type ContextoIntegracao,
  type GravadorSghIntegracao,
  METODOS_PORTA_INTEGRACAO,
  type PortaIntegracao,
} from './porta.js';

function gravador(e: Escritor, c: ContextoIntegracao): GravadorSghIntegracao {
  const h = c.hospital;
  return {
    criarParceiro: (p, u) => criarParceiro(e, h, p, u),
    alterarParceiro: (codigo, p, u) => alterarParceiro(e, h, codigo, p, u),
    gravarCredencial: (codigo, cliente, resumo, u) => gravarCredencial(e, h, codigo, cliente, resumo, u),
    tratarMorto: (id, t) => tratarMorto(e, h, id, t),
    registrarRecebida: (r) => registrarRecebida(e, h, r),
    concluirRecebida: (id, x) => concluirRecebida(e, h, id, x),
    registrarEnvio: (n) => registrarEnvio(e, h, n),
    outbox: (ev) =>
      gravarOutbox(e, { rede: c.rede, hospital: h, tipo: ev.tipo, chave: ev.chave, carga: ev.carga }),
  };
}

type Ler = <T>(c: ContextoIntegracao, fn: (l: Leitor) => Promise<T>) => Promise<T>;

/** As visões que a tela mede: as conhecidas dos parceiros e as que o banco tem (nunca o conteúdo). */
async function visoesMedidas(l: Leitor, contar: boolean) {
  // As da ficha (seção 3) sempre aparecem (existindo ou não); as demais, as que o banco tem pelos prefixos.
  const conhecidas = ['V_EPIMED_INTERNACAO', 'V_FIRST_LEITO'];
  const existentes = await visoesDeParceiroExistentes(l);
  return visoesDosParceiros(l, [...new Set([...conhecidas, ...existentes])].sort(), contar);
}

function leituras(ler: Ler): Omit<PortaIntegracao, 'destino' | 'gravarSgh' | 'executar' | 'podeGravar'> {
  return {
    relogio: (c) => ler(c, async (l) => new Date(`${(await relogioRecepcao(l)).agora}Z`)),
    parceiros: (c) => ler(c, (l) => lerParceiros(l, c.hospital)),
    parceiro: (c, codigo) => ler(c, (l) => lerParceiro(l, c.hospital, codigo)),
    credencial: (c, cliente) => ler(c, (l) => resumoDoSegredo(l, c.hospital, cliente)),
    envios: (c, f) => ler(c, (l) => lerEnvios(l, c.hospital, f)),
    envio: (c, id) => ler(c, (l) => lerEnvio(l, c.hospital, id)),
    mortos: (c) => ler(c, (l) => lerMortos(l, c.hospital)),
    contagens: (c) => ler(c, (l) => contagensDoMonitor(l, c.hospital)),
    recebidas: (c, f) => ler(c, (l) => lerRecebidas(l, c.hospital, f)),
    recebida: (c, id) => ler(c, (l) => lerRecebida(l, c.hospital, id)),
    saudeLegado: (c) => ler(c, (l) => saudeIntegracoesLegado(l)),
    visoes: (c, contar) => ler(c, (l) => visoesMedidas(l, contar)),
    identificacao: (c) => ler(c, (l) => identificacaoRnds(l)),
    interfacesApoio: (c) => ler(c, (l) => interfacesDeApoio(l)),
    deParaExame: (c, i, codigo) => ler(c, (l) => deParaDoExameApoio(l, i, codigo)),
    exameDoRetorno: (c, id) => ler(c, (l) => exameDoRetornoApoio(l, id)),
    exameLido: (c, id) =>
      ler(c, async (l) => {
        const x = await lerExameSadt(l, id);
        return x ? { id, chave: x.chave, versao: x.versao } : null;
      }),
    vinculos: (c, login) =>
      ler(c, async (l) =>
        (await vinculosDoLogin(l, login)).map((v) => ({
          vinculo: v.vinculo,
          conselho: v.conselho,
          nome: v.nome,
          ativo: v.ativo,
        })),
      ),
    marca: (c, fato) => ler(c, (l) => lerMarcaFato(l, c.hospital, fato)),
    fatosResultadoLiberado: (c, desde, lote) => ler(c, (l) => fatosResultadoLiberado(l, desde, lote)),
  };
}

export function portaIntegracaoLegado(
  nucleo: NucleoLegado,
  catalogo: FonteCatalogo,
  metricas?: MetricasExecutor,
  executorPronto?: Executor,
): PortaIntegracao {
  const executor = executorPronto ?? nucleo.criarExecutor({ catalogo, ...(metricas ? { metricas } : {}) });
  const ctx = (c: ContextoIntegracao) => ({ rede: c.rede, hospital: c.hospital, traceId: 'integracao' });
  return {
    destino: 'legado',
    podeGravar: (c, op, usuarioLegado) =>
      executor.liberacao(operacao(op), { rede: c.rede, hospital: c.hospital, usuarioLegado }),
    async executar(c, op, entrada, octx) {
      const r = await executor.executar(operacao(op), c.hospital, entrada, octx);
      return { resultado: r.resultado, repetida: r.repetida };
    },
    gravarSgh: (c, trilha, fn) =>
      nucleo.gravarSgh(ctx(c), async (e) => {
        const r = await fn(gravador(e, c));
        await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
        return r;
      }),
    ...leituras((c, fn) => nucleo.lerSomente(ctx(c), fn)),
  };
}

/** A porta sobre uma transação aberta (testes de integração na cópia, desfeita no fim). */
export function portaIntegracaoNaTransacao(e: Escritor, executor: Executor): PortaIntegracao {
  return {
    destino: 'legado',
    podeGravar: (c, op, usuarioLegado) =>
      executor.liberacao(operacao(op), { rede: c.rede, hospital: c.hospital, usuarioLegado }),
    async executar(c, op, entrada, octx) {
      const r = await executor.executar(operacao(op), c.hospital, entrada, octx, { escritor: e });
      return { resultado: r.resultado, repetida: r.repetida };
    },
    async gravarSgh(c, trilha, fn) {
      const r = await fn(gravador(e, c));
      await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
      return r;
    },
    ...leituras((_c, fn) => fn(e)),
  };
}

export function portaIntegracaoIndisponivel(): PortaIntegracao {
  return portaIndisponivel<PortaIntegracao>(METODOS_PORTA_INTEGRACAO);
}
