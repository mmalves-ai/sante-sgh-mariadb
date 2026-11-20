// Porta da manutenção (M55, etapa 1) sobre o núcleo do legado: leituras READ ONLY pelos repositórios de @sgh/legado; as
// gravações só do novo numa transação SGH_ com a SGH_TRILHA junto (o escritor só das SGH_). Recurso só do novo: o
// executor não é usado (nenhuma operação do legado). Em dev sobre a cópia compartilhada, as gravações SGH_ recusam
// (`sghSoLeitura`), como nos outros módulos. `portaManutencaoNaTransacao`: a mesma porta sobre UMA transação aberta (os
// testes de integração na cópia, desfeita).
import {
  abrirOsSgh,
  abrirQueixaDaOsSgh,
  cursosPesSgh,
  desvincularCursoModeloSgh,
  lerBaseObsolescencia,
  lerConclusoesDosCursos,
  lerCursoDoModelo,
  lerCursosDosModelos,
  lerEventosCiclo,
  registrarEventoCicloSgh,
  vincularCursoModeloSgh,
  alterarAlertaEquipamentoSgh,
  encerrarAlertaEquipamentoSgh,
  excluirAlertaEquipamentoSgh,
  gerarAcaoDeCampoSgh,
  incluirAlertaEquipamentoSgh,
  lerAcoesDoAlerta,
  lerAlertaEquipamento,
  lerAlertasEquipamento,
  lerParqueDoAlerta,
  lerVinculosTecnovigDaOs,
  alterarEquipamentoSgh,
  alterarPlanoSgh,
  ativarPlanoSgh,
  equipamentosDoRecurso,
  type Escritor,
  fornecedoresEstoque,
  fornecedorExiste,
  gravarAviso,
  gravarTrilha,
  incluirCoberturaSgh,
  alterarCoberturaSgh,
  encerrarCoberturaSgh,
  excluirCoberturaSgh,
  contarPlanosAtivosDoContrato,
  lerVersoesCobertura,
  incluirEquipamentoSgh,
  incluirPlanoSgh,
  type Leitor,
  lerCobertura,
  lerCoberturas,
  lerEquipamento,
  lerEquipamentoPorCodigo,
  lerEquipamentos,
  lerEventosOs,
  lerExecucoes,
  lerOcorrenciasDoPeriodo,
  lerOrdemServico,
  lerOrdensServico,
  lerPlano,
  lerPlanos,
  lerVersoesPlano,
  lerRecursoDeAgenda,
  loginsDoSetor,
  corrigirOsSgh,
  mudarOsSgh,
  nomesDosFornecedores,
  nomesDosUsuariosDaOs,
  type NucleoLegado,
  osAbertasDoEquipamento,
  recursosDeAgenda,
  registrarExecucaoSgh,
  relogioManutencao,
  setoresDaManutencao,
  somenteSgh,
  unidadesDaManutencao,
} from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import { portaIndisponivel } from '../exames/public-api.js';
import { type GravadorManutencao, METODOS_PORTA_MANUTENCAO, type PortaManutencao } from './porta.js';

const SEM_EXECUTOR = 'A manutenção não usa operação do executor: tudo é gravado só no novo.';

function gravador(e: Escritor, c: ContextoPortaM18): GravadorManutencao {
  const h = c.hospital;
  return {
    relogio: () => relogioManutencao(e),
    setores: () => setoresDaManutencao(e, false),
    equipamento: (id) => lerEquipamento(e, h, id),
    equipamentoPorCodigo: (codigo) => lerEquipamentoPorCodigo(e, h, codigo),
    os: (id) => lerOrdemServico(e, h, id, { travar: true }),
    osAbertasDoEquipamento: (eq) => osAbertasDoEquipamento(e, h, eq),
    plano: (id) => lerPlano(e, h, id, { travar: true }),
    cobertura: (id) => lerCobertura(e, h, id),
    recurso: (tipo, id) => lerRecursoDeAgenda(e, tipo, id),
    fornecedorExiste: (codigo) => fornecedorExiste(e, codigo),
    loginsDoSetor: (centro) => loginsDoSetor(e, centro),
    equipamentosDoRecurso: (r) => equipamentosDoRecurso(e, h, r),
    incluirEquipamento: (x) => incluirEquipamentoSgh(e, x),
    alterarEquipamento: (x) => alterarEquipamentoSgh(e, x),
    abrirOs: (x) => abrirOsSgh(e, x),
    mudarOs: (x) => mudarOsSgh(e, x),
    corrigirOs: (x) => corrigirOsSgh(e, x),
    incluirPlano: (x) => incluirPlanoSgh(e, x),
    ativarPlano: (x) => ativarPlanoSgh(e, x),
    alterarPlano: (x) => alterarPlanoSgh(e, x),
    registrarExecucao: (x) => registrarExecucaoSgh(e, x),
    incluirCobertura: (x) => incluirCoberturaSgh(e, x),
    planosAtivosDoContrato: (cob, eqs) => contarPlanosAtivosDoContrato(e, h, cob, eqs),
    alterarCobertura: (x) => alterarCoberturaSgh(e, x),
    encerrarCobertura: (x) => encerrarCoberturaSgh(e, x),
    excluirCobertura: (x) => excluirCoberturaSgh(e, x),
    incluirAlerta: (x) => incluirAlertaEquipamentoSgh(e, x),
    alterarAlerta: (x) => alterarAlertaEquipamentoSgh(e, x),
    encerrarAlerta: (x) => encerrarAlertaEquipamentoSgh(e, x),
    excluirAlerta: (x) => excluirAlertaEquipamentoSgh(e, x),
    gerarAcaoDeCampo: (x) => gerarAcaoDeCampoSgh(e, x),
    abrirQueixaDaOs: (x) => abrirQueixaDaOsSgh(e, x),
    cursoDoModelo: (id) => lerCursoDoModelo(e, h, id),
    vincularCursoModelo: (x) => vincularCursoModeloSgh(e, x),
    desvincularCursoModelo: (x) => desvincularCursoModeloSgh(e, x),
    eventosCiclo: (eq) => lerEventosCiclo(e, h, eq),
    registrarEventoCiclo: (x) => registrarEventoCicloSgh(e, x),
    avisar: (a) => gravarAviso(e, { ...a, rede: c.rede, hospital: h }),
  };
}

type Ler = <T>(c: ContextoPortaM18, fn: (l: Leitor) => Promise<T>) => Promise<T>;

function leituras(ler: Ler): Omit<PortaManutencao, 'destino' | 'podeGravar' | 'executar' | 'gravarSgh'> {
  return {
    relogio: (c) => ler(c, (l) => relogioManutencao(l)),
    setores: (c) => ler(c, (l) => setoresDaManutencao(l, false)),
    unidades: (c) => ler(c, (l) => unidadesDaManutencao(l)),
    recursos: (c, tipo) => ler(c, (l) => recursosDeAgenda(l, tipo)),
    recurso: (c, tipo, id) => ler(c, (l) => lerRecursoDeAgenda(l, tipo, id)),
    nomesDosUsuarios: (c, logins) => ler(c, (l) => nomesDosUsuariosDaOs(l, logins)),
    fornecedores: (c, termo) =>
      ler(c, async (l) =>
        (await fornecedoresEstoque(l, termo)).itens.map((f) => ({
          codigo: f.codigo,
          nome: f.fantasia || f.nome,
        })),
      ),
    nomesDosFornecedores: (c, codigos) => ler(c, (l) => nomesDosFornecedores(l, codigos)),
    equipamentos: (c, f) => ler(c, (l) => lerEquipamentos(l, c.hospital, f)),
    equipamento: (c, id) => ler(c, (l) => lerEquipamento(l, c.hospital, id)),
    equipamentoPorCodigo: (c, codigo) => ler(c, (l) => lerEquipamentoPorCodigo(l, c.hospital, codigo)),
    ordens: (c, f) => ler(c, (l) => lerOrdensServico(l, c.hospital, f)),
    os: (c, id) => ler(c, (l) => lerOrdemServico(l, c.hospital, id)),
    eventos: (c, os) => ler(c, (l) => lerEventosOs(l, c.hospital, os)),
    planos: (c, f) => ler(c, (l) => lerPlanos(l, c.hospital, f)),
    execucoes: (c, plano) => ler(c, (l) => lerExecucoes(l, c.hospital, plano)),
    versoesPlano: (c, plano) => ler(c, (l) => lerVersoesPlano(l, c.hospital, plano)),
    planoPorId: (c, id) => ler(c, (l) => lerPlano(l, c.hospital, id)),
    coberturas: (c, f) => ler(c, (l) => lerCoberturas(l, c.hospital, f)),
    versoesCobertura: (c, cob) => ler(c, (l) => lerVersoesCobertura(l, c.hospital, cob)),
    ocorrencias: (c, f) => ler(c, (l) => lerOcorrenciasDoPeriodo(l, c.hospital, f)),
    alertas: (c, f) => ler(c, (l) => lerAlertasEquipamento(l, c.hospital, f)),
    alerta: (c, id) => ler(c, (l) => lerAlertaEquipamento(l, c.hospital, id)),
    acoesDoAlerta: (c, id) => ler(c, (l) => lerAcoesDoAlerta(l, c.hospital, id)),
    parqueDoAlerta: (c, id) => ler(c, (l) => lerParqueDoAlerta(l, c.hospital, id)),
    vinculosTecnovigDaOs: (c, os) => ler(c, (l) => lerVinculosTecnovigDaOs(l, c.hospital, os)),
    cursosDosModelos: (c, chave) => ler(c, (l) => lerCursosDosModelos(l, c.hospital, chave)),
    catalogoCursos: (c) =>
      ler(c, async (l) =>
        (await cursosPesSgh(l, c.hospital)).map((x) => ({
          id: x.id,
          codigo: x.codigo,
          titulo: x.titulo,
          validadeMeses: x.validadeMeses,
          ativo: x.ativo,
        })),
      ),
    conclusoesDosCursos: (c, cursos) => ler(c, (l) => lerConclusoesDosCursos(l, c.hospital, cursos)),
    eventosCiclo: (c, eq) => ler(c, (l) => lerEventosCiclo(l, c.hospital, eq)),
    baseObsolescencia: (c, eq, desde) => ler(c, (l) => lerBaseObsolescencia(l, c.hospital, eq, desde)),
  };
}

const semExecutor = {
  podeGravar: () => Promise.resolve({ pode: false, codigo: 'sem-operacao', motivo: SEM_EXECUTOR }),
  executar: (): Promise<never> => Promise.reject(new Error(SEM_EXECUTOR)),
};

export function portaManutencaoLegado(
  nucleo: NucleoLegado,
  opcoes: { sghSoLeitura?: boolean } = {},
): PortaManutencao {
  const ctx = (c: ContextoPortaM18) => ({ rede: c.rede, hospital: c.hospital, traceId: 'manutencao' });
  return {
    destino: 'legado',
    ...semExecutor,
    gravarSgh: (c, trilha, fn) => {
      if (opcoes.sghSoLeitura)
        return Promise.reject(
          new ErroProblema(
            'recurso-desligado',
            403,
            'Gravação desligada neste ambiente',
            'Neste ambiente de desenvolvimento o banco é só de leitura: nada é gravado.',
            { codigo: 'somente-leitura' },
          ),
        );
      return nucleo.gravarSgh(ctx(c), async (e0) => {
        const e = somenteSgh(e0);
        const r = await fn(gravador(e, c));
        await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
        return r;
      });
    },
    ...leituras((c, fn) => nucleo.lerSomente(ctx(c), fn)),
  };
}

/** A porta sobre uma transação aberta (testes de integração na cópia, desfeita no fim). */
export function portaManutencaoNaTransacao(e: Escritor): PortaManutencao {
  return {
    destino: 'legado',
    ...semExecutor,
    async gravarSgh(c, trilha, fn) {
      const r = await fn(gravador(somenteSgh(e), c));
      await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
      return r;
    },
    ...leituras((_c, fn) => fn(e as unknown as Leitor)),
  };
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaManutencaoIndisponivel(): PortaManutencao {
  return portaIndisponivel<PortaManutencao>(METODOS_PORTA_MANUTENCAO);
}
