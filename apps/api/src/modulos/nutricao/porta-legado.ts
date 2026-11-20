// Porta da nutrição, do mapa de dietas e do serviço social sobre o núcleo do legado (M45, etapa 5): leituras READ ONLY
// pelos repositórios de @sgh/legado; as gravações só do novo numa transação SGH_ com a SGH_TRILHA junto. Em dev sobre a
// cópia compartilhada, as gravações SGH_ são recusadas (`sghSoLeitura`), como nos outros módulos.
import {
  acompanhanteSgh,
  acompanhantesDaInternacao,
  acompanhantesVigentes,
  alergiasAlimentaresDosPacientes,
  barreirasDasInternacoes,
  barreirasSociaisAbertas,
  checagensDasDietas,
  cirurgiasNaJanela,
  dietasEnteraisDoAtendimento,
  encerrarDietaAcompanhanteSgh,
  examesNaJanela,
  type Executor,
  fecharMapaDietasSgh,
  fichasNutricionais,
  type FonteCatalogo,
  gravarTrilha,
  instanteCivil,
  internacaoParaNutricao,
  internacoesComMeta,
  internadosParaNutricao,
  itensDietaDosAtendimentos,
  type Leitor,
  metaTerapia,
  type MetricasExecutor,
  type NucleoLegado,
  operacao,
  primeiraAdministradaDasDietas,
  refeicoesDoCadastro,
  registrarAcompanhamentoTerapiaSgh,
  registrarAvaliacaoSocialSgh,
  registrarDietaAcompanhanteSgh,
  registrarMetaTerapiaSgh,
  registrarTriagemNutricionalSgh,
  registrosSociaisDaInternacao,
  relogioRecepcao,
  retratoDoMapa,
  somenteSgh,
  terapiaDaInternacao,
  triagensDasInternacoes,
  ultimosRegistrosSociais,
  unidadesDeInternacao,
  vinculosCategoriaDoLogin,
  cadastrosProfissionaisDoLogin,
  alteracoesHot,
  alterarDietaAcompanhanteSgh,
  avaliacoesNptDaInternacao,
  correcoesDosRegistros,
  dominiosDoBalanco,
  internacaoDoRegistroNutricao,
  lancamentosDoBalanco,
  registrarAdendoSocialSgh,
  registrarAlteracaoHotSgh,
  registrarAvaliacaoNptSgh,
  registrarCorrecaoNutricaoSgh,
} from '@sgh/legado';
import { volumesParenteraisDoBalanco } from '@sgh/dominio-pep';
import { ErroProblema } from '../../problema.filter.js';
import { portaIndisponivel } from '../exames/public-api.js';
import { type ContextoNutricao, METODOS_PORTA_NUTRICAO, type PortaNutricao } from './porta.js';

export function portaNutricaoLegado(
  nucleo: NucleoLegado,
  catalogo: FonteCatalogo,
  metricas?: MetricasExecutor,
  executorPronto?: Executor,
  opcoes: { sghSoLeitura?: boolean } = {},
): PortaNutricao {
  const executor = executorPronto ?? nucleo.criarExecutor({ catalogo, ...(metricas ? { metricas } : {}) });
  const ctx = (c: ContextoNutricao) => ({ rede: c.rede, hospital: c.hospital, traceId: 'nutricao' });
  const ler = <T>(c: ContextoNutricao, fn: (l: Leitor) => Promise<T>) => nucleo.lerSomente(ctx(c), fn);
  return {
    destino: 'legado',
    podeGravar: (c, op, usuarioLegado) =>
      executor.liberacao(operacao(op), { rede: c.rede, hospital: c.hospital, usuarioLegado }),
    async executar(c, op, entrada, octx) {
      const r = await executor.executar(operacao(op), c.hospital, entrada, octx);
      return { resultado: r.resultado, repetida: r.repetida, trilha: r.trilha };
    },
    gravarSgh: (c, trilha, fn) => {
      if (opcoes.sghSoLeitura)
        return Promise.reject(
          new ErroProblema(
            'recurso-desligado',
            403,
            'Gravação desligada neste ambiente',
            'Neste ambiente de desenvolvimento o banco é só de leitura: a nutrição e o serviço social não gravam.',
            { codigo: 'somente-leitura' },
          ),
        );
      return nucleo.gravarSgh(ctx(c), async (e0) => {
        const e = somenteSgh(e0);
        const h = c.hospital;
        const r = await fn({
          triar: (x) => registrarTriagemNutricionalSgh(e, { hospital: h, ...x }),
          registrarMeta: (x) => registrarMetaTerapiaSgh(e, { hospital: h, ...x }),
          registrarAcompanhamento: (x) => registrarAcompanhamentoTerapiaSgh(e, { hospital: h, ...x }),
          fecharMapa: (x) => fecharMapaDietasSgh(e, { hospital: h, ...x }),
          registrarAcompanhante: (x) => registrarDietaAcompanhanteSgh(e, { hospital: h, ...x }),
          encerrarAcompanhante: (x) => encerrarDietaAcompanhanteSgh(e, { hospital: h, ...x }),
          registrarSocial: (x) => registrarAvaliacaoSocialSgh(e, { hospital: h, ...x }),
          registrarEvento: async (linha) => {
            await gravarTrilha(e, linha);
          },
          corrigir: (x) => registrarCorrecaoNutricaoSgh(e, { hospital: h, ...x }),
          avaliarNpt: (x) => registrarAvaliacaoNptSgh(e, { hospital: h, ...x }),
          adendoSocial: (x) => registrarAdendoSocialSgh(e, { hospital: h, ...x }),
          alterarAcompanhante: (x) => alterarDietaAcompanhanteSgh(e, { hospital: h, ...x }),
          registrarAlteracao: (x) => registrarAlteracaoHotSgh(e, { hospital: h, ...x }),
        });
        await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
        return r;
      });
    },
    relogio: async (c) => {
      const r = await ler(c, (l) => relogioRecepcao(l));
      return { agora: r.agora.slice(0, 16), hoje: r.hoje };
    },
    vinculos: (c, login) => ler(c, (l) => vinculosCategoriaDoLogin(l, login)),
    cadastrosDoLogin: (c, login) => ler(c, (l) => cadastrosProfissionaisDoLogin(l, login)),
    internados: (c, unidade) => ler(c, (l) => internadosParaNutricao(l, unidade)),
    internacao: (c, reg) => ler(c, (l) => internacaoParaNutricao(l, reg)),
    triagens: (c, regs) => ler(c, (l) => triagensDasInternacoes(l, c.hospital, regs)),
    comMeta: (c, regs) => ler(c, (l) => internacoesComMeta(l, c.hospital, regs)),
    dietasEnterais: (c, atendimento, desde) =>
      ler(c, (l) => dietasEnteraisDoAtendimento(l, atendimento, instanteCivil(desde))),
    checagens: (c, itens, desde) => ler(c, (l) => checagensDasDietas(l, itens, instanteCivil(desde))),
    primeiraAdministrada: (c, itens) => ler(c, (l) => primeiraAdministradaDasDietas(l, itens)),
    terapia: (c, reg) => ler(c, (l) => terapiaDaInternacao(l, c.hospital, reg)),
    meta: (c, id) => ler(c, (l) => metaTerapia(l, c.hospital, id)),
    fichas: (c, paciente) => ler(c, (l) => fichasNutricionais(l, paciente)),
    sociais: (c, reg) => ler(c, (l) => registrosSociaisDaInternacao(l, c.hospital, reg)),
    ultimosSociais: (c, regs) => ler(c, (l) => ultimosRegistrosSociais(l, c.hospital, regs)),
    barreirasSociais: (c, regs) => ler(c, (l) => barreirasSociaisAbertas(l, c.hospital, regs)),
    barreiras: (c, regs) => ler(c, (l) => barreirasDasInternacoes(l, c.hospital, regs)),
    unidades: (c) => ler(c, (l) => unidadesDeInternacao(l)),
    refeicoes: (c) => ler(c, (l) => refeicoesDoCadastro(l)),
    itensDieta: (c, atendimentos, servirEm) =>
      ler(c, (l) => itensDietaDosAtendimentos(l, atendimentos, servirEm)),
    alergiasAlimentares: (c, pacientes) => ler(c, (l) => alergiasAlimentaresDosPacientes(l, pacientes)),
    cirurgias: (c, de, ate) => ler(c, (l) => cirurgiasNaJanela(l, de, ate)),
    exames: (c, pronts, de, ate) => ler(c, (l) => examesNaJanela(l, pronts, de, ate)),
    acompanhantesVigentes: (c, regs) => ler(c, (l) => acompanhantesVigentes(l, c.hospital, regs)),
    acompanhantes: (c, reg) => ler(c, (l) => acompanhantesDaInternacao(l, c.hospital, reg)),
    acompanhante: (c, id) => ler(c, (l) => acompanhanteSgh(l, c.hospital, id)),
    retrato: (c, unidade, refeicao, data) =>
      ler(c, (l) => retratoDoMapa(l, c.hospital, unidade, refeicao, data)),
    correcoes: (c, registro, ids) => ler(c, (l) => correcoesDosRegistros(l, c.hospital, registro, ids)),
    internacaoDoRegistro: (c, registro, id) =>
      ler(c, (l) => internacaoDoRegistroNutricao(l, c.hospital, registro, id)),
    avaliacoesNpt: (c, reg) => ler(c, (l) => avaliacoesNptDaInternacao(l, c.hospital, reg)),
    balancoParenteral: (c, atendimento, desde) =>
      ler(c, async (l) => {
        const ate = `${String(Number(desde.slice(0, 4)) + 1)}${desde.slice(4, 16)}`;
        const [d, ls] = await Promise.all([
          dominiosDoBalanco(l),
          lancamentosDoBalanco(l, { hospital: c.hospital, atendimento, de: desde.slice(0, 16), ate }),
        ]);
        return volumesParenteraisDoBalanco(ls.itens, d.grupos);
      }),
    alteracoesAcompanhante: (c, ids) =>
      ler(c, (l) => alteracoesHot(l, c.hospital, 'SGH_HOT_DIETA_ACOMP', ids)),
  };
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaNutricaoIndisponivel(): PortaNutricao {
  return portaIndisponivel<PortaNutricao>(METODOS_PORTA_NUTRICAO);
}
