// Porta dos registros clínicos sobre o núcleo do legado (M22): leituras em transação curta READ ONLY (os BLOB
// materializados dentro dela) e as gravações pelo EXECUTOR do M04 (as receitas do grupo pep). Em dev sobre a
// cópia compartilhada, o executor só de leitura recusa a gravação com o motivo (como o cadastro do M11).
import {
  agoraDoBanco,
  atendimentosDoPaciente,
  cabecalhoDocumento,
  type Executor,
  type FonteCatalogo,
  historicoDaPergunta,
  lerCabecalhoRegistro,
  lerDefinicaoFormulario,
  lerProvaDoRegistro,
  lerRascunho,
  type Leitor,
  listarModelosFormulario,
  type MetricasExecutor,
  modelosDeImpressao,
  modelosDoRegistro,
  type NucleoLegado,
  operacao,
  profissionalDoUsuario,
  rascunhosDoPaciente,
  rascunhosDoProfissional,
  respostasDoRegistro,
  respostasDoUltimoRegistro,
  retratosAtuais,
  seloDoModelo,
} from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoRegistro, PortaRegistro } from './registro-porta.js';

const p2 = (n: number) => String(n).padStart(2, '0');
function localIso(d: Date): string {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}

export function portaRegistroLegado(
  nucleo: NucleoLegado,
  catalogo: FonteCatalogo,
  metricas?: MetricasExecutor,
  executorPronto?: Executor,
): PortaRegistro {
  const executor = executorPronto ?? nucleo.criarExecutor({ catalogo, ...(metricas ? { metricas } : {}) });
  const ler = <T>(c: ContextoRegistro, fn: (l: Leitor) => Promise<T>) =>
    nucleo.lerSomente({ rede: c.rede, hospital: c.hospital, traceId: 'registro-clinico' }, fn);
  return {
    destino: 'legado',
    profissional: (c, login) => ler(c, (l) => profissionalDoUsuario(l, login)),
    modelos: (c) => ler(c, (l) => modelosDoRegistro(l)),
    definicao: (c, modelo) =>
      ler(c, async (l) => {
        const m = (await listarModelosFormulario(l)).find((x) => x.id === modelo);
        return m ? lerDefinicaoFormulario(l, m) : null;
      }),
    selo: (c, modelo) => ler(c, (l) => seloDoModelo(l, modelo)),
    atendimentos: (c, paciente) => ler(c, (l) => atendimentosDoPaciente(l, paciente)),
    retratos: (c, atendimento, paciente) => ler(c, (l) => retratosAtuais(l, atendimento, paciente)),
    rascunhosDoProfissional: (c, cbos) => ler(c, (l) => rascunhosDoProfissional(l, cbos, c.hospital)),
    rascunhosDoPaciente: (c, paciente, modelo) =>
      ler(c, (l) => rascunhosDoPaciente(l, paciente, modelo, c.hospital)),
    lerRascunho: (c, id) => ler(c, (l) => lerRascunho(l, id, c.hospital)),
    ultimoRegistro: (c, paciente, modelo) => ler(c, (l) => respostasDoUltimoRegistro(l, paciente, modelo)),
    historico: (c, paciente, modelo, ordem) => ler(c, (l) => historicoDaPergunta(l, paciente, modelo, ordem)),
    cabecalhoRegistro: (c, registro) => ler(c, (l) => lerCabecalhoRegistro(l, registro)),
    respostasRegistro: (c, registro) => ler(c, (l) => respostasDoRegistro(l, registro)),
    prova: (c, registro) => ler(c, (l) => lerProvaDoRegistro(l, c.hospital, registro)),
    cabecalhoDocumento: (c, retratos, cbo, situacao) =>
      ler(c, (l) => cabecalhoDocumento(l, retratos, cbo, situacao)),
    modelosImpressao: (c) => ler(c, (l) => modelosDeImpressao(l)),
    agora: (c) => ler(c, async (l) => localIso(await agoraDoBanco(l))),
    podeGravar: (c, op, usuarioLegado) =>
      executor.liberacao(operacao(op), { rede: c.rede, hospital: c.hospital, usuarioLegado }),
    async registrar(c, e, ctx) {
      const r = await executor.executar(operacao('pep.registrarEvolucao'), c.hospital, e, ctx);
      return { registro: Number(r.resultado['registro']), trilha: r.trilha };
    },
    async salvarRascunho(c, e, ctx) {
      const r = await executor.executar(operacao('pep.salvarRascunho'), c.hospital, e, ctx);
      return {
        rascunho: Number(r.resultado['rascunho']),
        versao: String(r.resultado['versao']),
        trilha: r.trilha,
      };
    },
    async descartarRascunho(c, e, ctx) {
      await executor.executar(operacao('pep.descartarRascunho'), c.hospital, e, ctx);
    },
    async suspender(c, e, ctx) {
      await executor.executar(operacao('pep.suspenderEvolucao'), c.hospital, e, ctx);
    },
  };
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaRegistroIndisponivel(): PortaRegistro {
  const recusa = (): Promise<never> =>
    Promise.reject(
      new ErroProblema(
        'indisponivel',
        503,
        'Banco do estabelecimento indisponível',
        'O banco do estabelecimento não está configurado: nada foi lido nem gravado.',
      ),
    );
  return {
    destino: 'legado',
    profissional: recusa,
    modelos: recusa,
    definicao: recusa,
    selo: recusa,
    atendimentos: recusa,
    retratos: recusa,
    rascunhosDoProfissional: recusa,
    rascunhosDoPaciente: recusa,
    lerRascunho: recusa,
    ultimoRegistro: recusa,
    historico: recusa,
    cabecalhoRegistro: recusa,
    respostasRegistro: recusa,
    prova: recusa,
    cabecalhoDocumento: recusa,
    modelosImpressao: recusa,
    agora: recusa,
    podeGravar: recusa,
    registrar: recusa,
    salvarRascunho: recusa,
    descartarRascunho: recusa,
    suspender: recusa,
  };
}
