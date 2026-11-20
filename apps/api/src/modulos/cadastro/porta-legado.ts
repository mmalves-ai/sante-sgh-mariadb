// Porta do cadastro sobre o núcleo do legado (M11): leituras READ ONLY pelos repositórios de @sgh/legado;
// cadastro e alteração pelo EXECUTOR (receitas cadastro.cadastrarPaciente e cadastro.alterarPaciente, trilha
// dupla e índice de busca na mesma transação); fila e consentimento em transação só SGH_. Fora de dev/ci,
// sem o núcleo, a porta indisponível responde 503 (falha fechada).
import type { EstadoOperacao } from '@sgh/contratos';
import {
  buscarPacientesDireto,
  buscarPessoas,
  candidatosPorCpf,
  chavesRepetidasSolicitante,
  consentimentosDoPaciente,
  agruparVinculos,
  dadosProfissional,
  eventosDoProfissional,
  loginsDosRegistros,
  loginsParaProfissional,
  vinculosDoProfissional,
  vinculosDoRegistro,
  decidirOutraPessoa,
  type Escritor,
  type Executor,
  extrasDaFicha,
  fichaProfissional,
  type FonteCatalogo,
  gravarParesDuplicidade,
  gravarTrilha,
  gruposCandidatos,
  historicoPaciente,
  historicoProfissional,
  homonimosMarcados,
  idsPorFonetica,
  idsPorPalavra,
  idsPorPalavras,
  indiceTemLinhas,
  lerCep,
  type Leitor,
  lerFila,
  lerPacientesPorIds,
  lerPar,
  listarProfissionais,
  listarSolicitantes,
  marcarUnificadosNoLegado,
  type MetricasExecutor,
  type NucleoLegado,
  opcoesConsentimento,
  opcoesProfissional,
  operacao,
  procedimentosDaEspecialidade,
  registrarConsentimento,
  revogarConsentimento,
  siglasDosConselhos,
  conselhoPorSigla,
  solicitantesPorRegistro,
  unificacoesDoPaciente,
} from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoPorta, PortaCadastro } from './porta.js';

export function portaCadastroLegado(
  nucleo: NucleoLegado,
  catalogo: FonteCatalogo,
  metricas?: MetricasExecutor,
  executorPronto?: Executor,
): PortaCadastro {
  const executor = executorPronto ?? nucleo.criarExecutor({ catalogo, ...(metricas ? { metricas } : {}) });
  const ctx = (c: ContextoPorta) => ({ rede: c.rede, hospital: c.hospital, traceId: 'cadastro' });
  const ler = <T>(c: ContextoPorta, fn: (l: Leitor) => Promise<T>) => nucleo.lerSomente(ctx(c), fn);
  const sgh = <T>(c: ContextoPorta, fn: (e: Escritor) => Promise<T>) => nucleo.gravarSgh(ctx(c), fn);
  return {
    destino: 'legado',
    estado: (op, h) => catalogo.estado(op, h),
    podeGravar: (c, op, usuarioLegado) =>
      executor.liberacao(operacao(op), { rede: c.rede, hospital: c.hospital, usuarioLegado }),
    buscarDireto: (c, criterio, inativos) => ler(c, (l) => buscarPacientesDireto(l, criterio, inativos)),
    idsPorPalavra: (c, ent, campos, p) => ler(c, (l) => idsPorPalavra(l, ent, campos, p)),
    idsPorFonetica: (c, ent, campos, f, teto) => ler(c, (l) => idsPorFonetica(l, ent, campos, f, teto)),
    idsPorPalavras: (c, ent, campos, ps, teto) => ler(c, (l) => idsPorPalavras(l, ent, campos, ps, teto)),
    indiceTemLinhas: (c, ent) => ler(c, (l) => indiceTemLinhas(l, ent)),
    lerPacientes: (c, ids) => ler(c, (l) => lerPacientesPorIds(l, ids)),
    extrasDaFicha: (c, p) => ler(c, (l) => extrasDaFicha(l, p)),
    historico: (c, id, pagina, por) => ler(c, (l) => historicoPaciente(l, id, pagina, por)),
    unificacoes: (c, id) => ler(c, (l) => unificacoesDoPaciente(l, id)),
    homonimos: (c, ids) => ler(c, (l) => homonimosMarcados(l, c.hospital, ids)),
    candidatosPorCpf: (c, cpf) => ler(c, (l) => candidatosPorCpf(l, cpf)),
    cepExiste: async (c, cep) => (await ler(c, (l) => lerCep(l, cep))) !== null,
    lerCep: (c, cep) => ler(c, (l) => lerCep(l, cep)),
    async cadastrar(c, entrada, octx) {
      const r = await executor.executar(operacao('cadastro.cadastrarPaciente'), c.hospital, entrada, octx);
      return {
        resultado: {
          idPaciente: Number(r.resultado['idPaciente']),
          prontuario: Number(r.resultado['prontuario']),
        },
        trilha: r.trilha,
      };
    },
    async alterar(c, entrada, octx) {
      const r = await executor.executar(operacao('cadastro.alterarPaciente'), c.hospital, entrada, octx);
      return { resultado: { idPaciente: Number(r.resultado['idPaciente']) }, trilha: r.trilha };
    },
    async unificar(c, entrada, octx) {
      const r = await executor.executar(operacao('cadastro.unificarPaciente'), c.hospital, entrada, octx);
      return {
        resultado: {
          idAbsorvido: Number(r.resultado['idAbsorvido']),
          idSobrevivente: Number(r.resultado['idSobrevivente']),
        },
        trilha: r.trilha,
      };
    },
    gruposCandidatos: (c) => ler(c, (l) => gruposCandidatos(l)),
    lerFila: (c, s, pagina, por) => ler(c, (l) => lerFila(l, c.hospital, s, pagina, por)),
    lerPar: (c, id) => ler(c, (l) => lerPar(l, c.hospital, id)),
    gravarPares: (c, pares, inativos, trilha) =>
      sgh(c, async (e) => {
        const n = await gravarParesDuplicidade(e, c.hospital, pares);
        await marcarUnificadosNoLegado(e, c.hospital, inativos);
        await gravarTrilha(e, { ...trilha, chaveNaturalAlvo: `novos:${n}` });
        return n;
      }),
    decidirOutraPessoa: (c, id, usuario, justificativa, trilha) =>
      sgh(c, async (e) => {
        const r = await decidirOutraPessoa(e, c.hospital, id, usuario, justificativa);
        await gravarTrilha(e, { ...trilha, idAlvo: String(id), chaveNaturalAlvo: `par:${r.a}:${r.b}` });
        return r;
      }),
    opcoesConsentimento: (c) => ler(c, (l) => opcoesConsentimento(l)),
    consentimentos: (c, id) => ler(c, (l) => consentimentosDoPaciente(l, c.hospital, id)),
    registrarConsentimento: (c, r, trilha) =>
      sgh(c, async (e) => {
        const id = await registrarConsentimento(e, { ...r, hospital: c.hospital });
        await gravarTrilha(e, { ...trilha, idAlvo: String(id) });
        return id;
      }),
    revogarConsentimento: (c, r, trilha) =>
      sgh(c, async (e) => {
        await revogarConsentimento(e, { ...r, hospital: c.hospital });
        await gravarTrilha(e, { ...trilha, idAlvo: String(r.id) });
      }),
    listarProfissionais: (c, ids) => ler(c, (l) => listarProfissionais(l, ids)),
    fichaProfissional: (c, id) => ler(c, (l) => fichaProfissional(l, id)),
    historicoProfissional: (c, id, pagina, por) => ler(c, (l) => historicoProfissional(l, id, pagina, por)),
    listarSolicitantes: (c, ids) => ler(c, (l) => listarSolicitantes(l, ids)),
    solicitantesPorRegistro: (c, r) => ler(c, (l) => solicitantesPorRegistro(l, r)),
    chavesRepetidasSolicitante: (c) => ler(c, (l) => chavesRepetidasSolicitante(l)),
    buscarPessoas: (c, doc) => ler(c, (l) => buscarPessoas(l, doc)),
    siglasDosConselhos: (c) => ler(c, (l) => siglasDosConselhos(l)),
    conselhoPorSigla: (c, sigla) => ler(c, (l) => conselhoPorSigla(l, sigla)),
    async cadastrarSolicitante(c, entrada, octx) {
      const r = await executor.executar(operacao('cadastro.cadastrarSolicitante'), c.hospital, entrada, octx);
      return { resultado: { solicitante: Number(r.resultado['solicitante']) }, trilha: r.trilha };
    },
    dadosProfissional: (c, id) => ler(c, (l) => dadosProfissional(l, id)),
    opcoesProfissional: (c) => ler(c, (l) => opcoesProfissional(l)),
    async gravarProfissional(c, op, entrada, octx) {
      const r = await executor.executar(operacao(op), c.hospital, entrada, octx);
      const resultado: Record<string, number> = {};
      for (const k of ['profissional', 'registro', 'semRegistroAtivo'])
        if (r.resultado[k] !== undefined) resultado[k] = Number(r.resultado[k]);
      return { resultado, trilha: r.trilha };
    },
    loginsProfissional: (c) => ler(c, (l) => loginsParaProfissional(l)),
    loginsDosRegistros: (c, id) => ler(c, (l) => loginsDosRegistros(l, id)),
    eventosProfissional: (c, id) => ler(c, (l) => eventosDoProfissional(l, id)),
    vinculosProfissional: (c, id, registro) =>
      ler(c, async (l) =>
        agruparVinculos(
          registro === undefined
            ? await vinculosDoProfissional(l, id)
            : await vinculosDoRegistro(l, registro),
        ),
      ),
    procedimentosDaEspecialidade: (c, esp, pagina, por) =>
      ler(c, (l) => procedimentosDaEspecialidade(l, esp, pagina, por)),
  };
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaCadastroIndisponivel(): PortaCadastro {
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
    estado: (): EstadoOperacao | null => null,
    podeGravar: async () => ({
      pode: false,
      codigo: 'indisponivel',
      motivo: 'O banco do estabelecimento não está configurado: nada é gravado.',
    }),
    buscarDireto: recusa,
    idsPorPalavra: recusa,
    idsPorFonetica: recusa,
    idsPorPalavras: recusa,
    indiceTemLinhas: recusa,
    lerPacientes: recusa,
    extrasDaFicha: recusa,
    historico: recusa,
    unificacoes: recusa,
    homonimos: recusa,
    candidatosPorCpf: recusa,
    cepExiste: recusa,
    lerCep: recusa,
    cadastrar: recusa,
    alterar: recusa,
    unificar: recusa,
    gruposCandidatos: recusa,
    lerFila: recusa,
    lerPar: recusa,
    gravarPares: recusa,
    decidirOutraPessoa: recusa,
    opcoesConsentimento: recusa,
    consentimentos: recusa,
    registrarConsentimento: recusa,
    revogarConsentimento: recusa,
    listarProfissionais: recusa,
    fichaProfissional: recusa,
    historicoProfissional: recusa,
    listarSolicitantes: recusa,
    solicitantesPorRegistro: recusa,
    chavesRepetidasSolicitante: recusa,
    buscarPessoas: recusa,
    siglasDosConselhos: recusa,
    conselhoPorSigla: recusa,
    cadastrarSolicitante: recusa,
    dadosProfissional: recusa,
    opcoesProfissional: recusa,
    gravarProfissional: recusa,
    loginsProfissional: recusa,
    loginsDosRegistros: recusa,
    eventosProfissional: recusa,
    vinculosProfissional: recusa,
    procedimentosDaEspecialidade: recusa,
  };
}
