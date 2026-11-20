// Porta da gestão de pessoas sobre o núcleo do legado (M52.1): cada leitura numa transação curta READ ONLY no banco do
// estabelecimento da sessão, pelas leituras de @sgh/legado; as gravações SGH_PES_* numa transação SGH_ (`somenteSgh`:
// nenhuma tabela do outro sistema) com a SGH_TRILHA e a SGH_OUTBOX na mesma transação; o bloqueio do usuário no
// desligamento pelo EXECUTOR (`acesso.bloquearUsuario`, a receita do M10 com o cenário `desligamento`). Em dev sobre a
// cópia compartilhada, as gravações são recusadas com o motivo (`sghSoLeitura`; o executor só de leitura recusa o
// bloqueio), como nos outros módulos: a prova da gravação é a integração e a assinatura, sob a trava da cópia e
// desfeitas. `portaPessoasNaTransacao`: a mesma porta sobre UMA transação aberta (integração na cópia, desfeita).
import {
  alterarVinculoPesSgh,
  cargoPesSgh,
  centrosDeCusto,
  correcoesPesSgh,
  corrigirVinculoPesSgh,
  dependentesPesSgh,
  desligarVinculoPesSgh,
  encerrarDependentePesSgh,
  type Escritor,
  type Executor,
  gravarHabilitacaoPesSgh,
  gravarOutbox,
  gravarTrilha,
  habilitacoesPesSgh,
  historicoPesSgh,
  incluirDependentePesSgh,
  incluirHistoricoPesSgh,
  incluirVinculoPesSgh,
  type Leitor,
  ligarCargoVinculoPesSgh,
  listarProfissionais,
  listarVinculosPesSgh,
  type NucleoLegado,
  operacao,
  registrarCorrecaoPesSgh,
  pessoaPorCpf,
  registroConselhoPorId,
  registrosDosColaboradoresAtivos,
  relogioRecepcao,
  somenteSgh,
  tiposRescisao,
  ultimaVigenciaPesSgh,
  ultimoConselhoDiaPesSgh,
  unidadesDoEstabelecimento,
  unidadesDosRegistros,
  usuarioPorId,
  usuariosDoProfissional,
  versionarDependentePesSgh,
  vinculoPesSgh,
  vinculosAtivosDoUsuarioSgh,
  vinculosDaPessoaSgh,
  vinculosPorCpfSgh,
} from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import { portaIndisponivel } from '../exames/public-api.js';
import {
  type ContextoPessoas,
  type GravadorPessoas,
  METODOS_PORTA_PESSOAS,
  type PortaPessoas,
} from './porta.js';

/** W0-06: as correções do colaborador e dos dependentes ficam sob o vínculo (OPERACAO distingue). */
const TABELA_CORRECAO = 'SGH_PES_VINCULO';

type Ler = <T>(c: ContextoPessoas, fn: (l: Leitor) => Promise<T>) => Promise<T>;

function leituras(ler: Ler): Omit<PortaPessoas, 'destino' | 'podeGravar' | 'executar' | 'gravarSgh'> {
  return {
    hoje: (c) => ler(c, async (l) => (await relogioRecepcao(l)).hoje),
    centrosDeCusto: (c) =>
      ler(c, async (l) =>
        (await centrosDeCusto(l)).map((x) => ({ codigo: x.codigo, nome: x.nome, ativo: x.ativo })),
      ),
    unidades: (c) => ler(c, (l) => unidadesDoEstabelecimento(l)),
    tiposRescisao: (c) => ler(c, (l) => tiposRescisao(l)),
    pessoaPorCpf: (c, cpf) => ler(c, (l) => pessoaPorCpf(l, cpf)),
    usuariosDoProfissional: (c, p) => ler(c, (l) => usuariosDoProfissional(l, p)),
    usuarioPorId: (c, id) => ler(c, (l) => usuarioPorId(l, id)),
    profissionais: (c, ids) =>
      ids.length === 0 ? Promise.resolve([]) : ler(c, (l) => listarProfissionais(l, ids)),
    vinculosPorCpf: (c, h) => ler(c, (l) => vinculosPorCpfSgh(l, c.hospital, h)),
    vinculo: (c, id) => ler(c, (l) => vinculoPesSgh(l, c.hospital, id)),
    vinculosDaPessoa: (c, p) => ler(c, (l) => vinculosDaPessoaSgh(l, c.hospital, p)),
    listarVinculos: (c, f) => ler(c, (l) => listarVinculosPesSgh(l, c.hospital, f)),
    historico: (c, v) => ler(c, (l) => historicoPesSgh(l, c.hospital, v)),
    dependentes: (c, v) => ler(c, (l) => dependentesPesSgh(l, c.hospital, v)),
    correcoes: (c, v) => ler(c, (l) => correcoesPesSgh(l, c.hospital, TABELA_CORRECAO, [v])),
    habilitacoes: (c, r) =>
      r.length === 0 ? Promise.resolve(new Map()) : ler(c, (l) => habilitacoesPesSgh(l, c.hospital, r)),
    registrosDosColaboradoresAtivos: (c) => ler(c, (l) => registrosDosColaboradoresAtivos(l, c.hospital)),
    registroConselho: (c, r) => ler(c, (l) => registroConselhoPorId(l, r)),
    unidadesDosRegistros: (c, r) =>
      r.length === 0 ? Promise.resolve(new Map()) : ler(c, (l) => unidadesDosRegistros(l, r)),
    ultimoRetrato: (c) => ler(c, (l) => ultimoConselhoDiaPesSgh(l, c.hospital)),
    cargoQuadro: (c, id) => ler(c, (l) => cargoPesSgh(l, c.hospital, id)),
  };
}

function gravador(e: Escritor, c: ContextoPessoas): GravadorPessoas {
  const h = c.hospital;
  return {
    vinculo: (id) => vinculoPesSgh(e, h, id),
    vinculosPorCpf: (x) => vinculosPorCpfSgh(e, h, x),
    vinculosAtivosDoUsuario: (u) => vinculosAtivosDoUsuarioSgh(e, h, u),
    ultimaVigencia: (v) => ultimaVigenciaPesSgh(e, h, v),
    incluirVinculo: (v) => incluirVinculoPesSgh(e, { hospital: h, ...v }),
    alterarVinculo: (m) => alterarVinculoPesSgh(e, { hospital: h, ...m }),
    desligarVinculo: (d) => desligarVinculoPesSgh(e, { hospital: h, ...d }),
    incluirHistorico: (x) => incluirHistoricoPesSgh(e, { hospital: h, ...x }),
    incluirDependente: (d) => incluirDependentePesSgh(e, { hospital: h, ...d }),
    encerrarDependente: (d) => encerrarDependentePesSgh(e, { hospital: h, ...d }),
    gravarHabilitacao: (x) => gravarHabilitacaoPesSgh(e, { hospital: h, ...x }),
    corrigirVinculo: (x) => corrigirVinculoPesSgh(e, { hospital: h, ...x }),
    cargoQuadro: (id) => cargoPesSgh(e, h, id),
    ligarCargo: (x) => ligarCargoVinculoPesSgh(e, { hospital: h, ...x }),
    versionarDependente: (d) => versionarDependentePesSgh(e, { hospital: h, ...d }),
    registrarCorrecao: ({ vinculo, ...x }) =>
      registrarCorrecaoPesSgh(e, { hospital: h, tabela: TABELA_CORRECAO, registro: vinculo, ...x }),
    outbox: (ev) => gravarOutbox(e, { rede: c.rede, hospital: h, ...ev }),
  };
}

const recusaSoLeitura = () =>
  Promise.reject(
    new ErroProblema(
      'recurso-desligado',
      403,
      'Gravação desligada neste ambiente',
      'Neste ambiente de desenvolvimento o banco é só de leitura: o cadastro de colaboradores não grava.',
      { codigo: 'somente-leitura' },
    ),
  );

export function portaPessoasLegado(
  nucleo: Pick<NucleoLegado, 'lerSomente'> & Partial<Pick<NucleoLegado, 'gravarSgh'>>,
  executor: Executor,
  opcoes: { sghSoLeitura?: boolean } = {},
): PortaPessoas {
  const ctx = (c: ContextoPessoas) => ({ rede: c.rede, hospital: c.hospital, traceId: 'pessoas' });
  return {
    destino: 'legado',
    podeGravar: (c, op, usuarioLegado) =>
      executor.liberacao(operacao(op), { rede: c.rede, hospital: c.hospital, usuarioLegado }),
    async executar(c, op, entrada, octx) {
      const r = await executor.executar(operacao(op), c.hospital, entrada, octx);
      return { resultado: r.resultado, repetida: r.repetida, trilha: r.trilha };
    },
    gravarSgh: (c, trilha, fn) => {
      const gravar = nucleo.gravarSgh?.bind(nucleo);
      if (opcoes.sghSoLeitura || !gravar) return recusaSoLeitura();
      return gravar(ctx(c), async (e0) => {
        const e = somenteSgh(e0);
        const r = await fn(gravador(e, c));
        await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
        return r;
      });
    },
    ...leituras((c, fn) => nucleo.lerSomente(ctx(c), fn)),
  };
}

/** A mesma porta sobre UMA transação aberta (integração na cópia, sempre desfeita). */
export function portaPessoasNaTransacao(e: Escritor, executor: Executor): PortaPessoas {
  return {
    destino: 'legado',
    podeGravar: (c, op, usuarioLegado) =>
      executor.liberacao(operacao(op), { rede: c.rede, hospital: c.hospital, usuarioLegado }),
    async executar(c, op, entrada, octx) {
      const r = await executor.executar(operacao(op), c.hospital, entrada, octx, { escritor: e });
      return { resultado: r.resultado, repetida: r.repetida, trilha: r.trilha };
    },
    async gravarSgh(c, trilha, fn) {
      const s = somenteSgh(e);
      const r = await fn(gravador(s, c));
      await gravarTrilha(s, typeof trilha === 'function' ? trilha(r) : trilha);
      return r;
    },
    ...leituras((_c, fn) => fn(e)),
  };
}

export function portaPessoasIndisponivel(): PortaPessoas {
  return portaIndisponivel<PortaPessoas>(METODOS_PORTA_PESSOAS);
}

/** O gravador sobre um escritor já `somenteSgh` (W0-06: a aprovação da solicitação grava o efeito na mesma transação). */
export { gravador as gravadorPessoasSgh };
