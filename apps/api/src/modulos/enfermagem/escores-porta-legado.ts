// Porta dos escores, da classificação e dos índices de UTI sobre o núcleo do legado (M45, etapa 2): leituras READ ONLY
// pelos repositórios de @sgh/legado; as gravações só do novo numa transação SGH_ (somenteSgh) com a SGH_TRILHA junto. Em
// dev sobre a cópia compartilhada, as gravações SGH_ são recusadas (`sghSoLeitura`), como nos outros módulos.
import {
  apachesValidadosDoPeriodo,
  classificacoesDaUnidade,
  classificarPacienteSgh,
  configuracaoIndicesUti,
  cumprirReavaliacoesSgh,
  dispensarReavaliacaoSgh,
  escalasEmFormulario,
  ultimosEscoresDosPacientes,
  escoresDosPacientes,
  gravarAviso,
  gravarCuidadosSgh,
  gravarEscoreSgh,
  gravarSinalVital,
  gravarTrilha,
  indicesUtiDoPaciente,
  internacoesParaEscores,
  type Leitor,
  type NucleoLegado,
  programarReavaliacaoSgh,
  publicarRegraEscoreSgh,
  reavaliacoesDosPacientes,
  registrarIndiceUtiSgh,
  regrasEscorePublicadas,
  somenteSgh,
  validarIndiceUtiSgh,
  vinculoParaClassificacao,
  estornarRegistroSgh,
  estornosDosRegistros,
  registroParaEstorno,
  decidirProfilaxiaTevSgh,
  decisoesProfilaxiaTev,
  retificarProfilaxiaTevSgh,
  prescreverContencaoSgh,
  checarContencaoSgh,
  adendoChecagemContencaoSgh,
  encerrarContencaoSgh,
  contencoesLidas,
  contencaoParaGravar,
  pacientesDiaDoCenso,
  acionarTrrSgh,
  registrarEventoTrrSgh,
  gravarFichaPcrSgh,
  retificarEventoTrrSgh,
  inativarTrrSgh,
  acionamentosDosEscores,
  acionamentosTrr,
  escoresComTrr,
  versoesPcr,
  incluirProtocoloInternadoSgh,
  registrarEventoProtocoloInternadoSgh,
  protocolosInternados,
  protocoloInternado,
  anexarFotoLesaoSgh,
  corrigirCurativoSgh,
  encerrarLesaoSgh,
  gravarVersaoLesaoSgh,
  inativarLesaoSgh,
  lesoesSgh,
  lesaoDoCurativoSgh,
  pacientesInternadosNoPeriodo,
  registrarCurativoSgh,
  registrarLesaoSgh,
} from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import { portaIndisponivel } from '../exames/public-api.js';
import { type ContextoEscores, METODOS_PORTA_ESCORES, type PortaEscores } from './escores-porta.js';

const naoGrava = () =>
  Promise.reject(
    new ErroProblema(
      'recurso-desligado',
      403,
      'Gravação pelo executor',
      'Os escores gravam só no Sante SGH: não há operação no banco do estabelecimento.',
    ),
  );

export function portaEscoresLegado(
  nucleo: NucleoLegado,
  opcoes: { sghSoLeitura?: boolean } = {},
): PortaEscores {
  const ctx = (c: ContextoEscores) => ({ rede: c.rede, hospital: c.hospital, traceId: 'escores' });
  const ler = <T>(c: ContextoEscores, fn: (l: Leitor) => Promise<T>) => nucleo.lerSomente(ctx(c), fn);
  return {
    destino: 'legado',
    podeGravar: async () => ({ pode: false, codigo: 'so-sante', motivo: 'Gravação só no Sante SGH.' }),
    executar: naoGrava,
    gravarSgh: (c, trilha, fn) => {
      if (opcoes.sghSoLeitura)
        return Promise.reject(
          new ErroProblema(
            'recurso-desligado',
            403,
            'Gravação desligada neste ambiente',
            'Neste ambiente de desenvolvimento o banco é só de leitura: o registro não é gravado.',
            { codigo: 'somente-leitura' },
          ),
        );
      return nucleo.gravarSgh(ctx(c), async (e0) => {
        const e = somenteSgh(e0);
        const h = c.hospital;
        const r = await fn({
          registrarEscore: async (x) => {
            const sinais: number[] = [];
            for (const s of x.sinais) sinais.push(await gravarSinalVital(e, { hospital: h, ...s }));
            const id = await gravarEscoreSgh(e, {
              hospital: h,
              ...x.escore,
              sinalVital: sinais[0] ?? x.escore.sinalVital ?? null,
            });
            if (x.cuidados.length)
              await gravarCuidadosSgh(e, {
                hospital: h,
                escore: id,
                decisoes: x.cuidados,
                usuario: x.escore.usuario,
              });
            if (x.cumprir)
              await cumprirReavaliacoesSgh(e, {
                hospital: h,
                paciente: x.escore.paciente,
                escala: x.cumprir.escala,
                quando: x.cumprir.quando,
                escore: id,
                registroFormulario: null,
                usuario: x.escore.usuario,
              });
            for (const p of x.programar)
              await programarReavaliacaoSgh(e, { hospital: h, ...p, chave: p.chave(id) }).catch(
                (erro: unknown) => {
                  // A mesma mudança de quadro já programada (repetição): segue.
                  if ((erro as { problema?: { codigo?: string } }).problema?.codigo !== 'ja-programada')
                    throw erro;
                },
              );
            let avisos = 0;
            for (const a of x.avisos)
              if ((await gravarAviso(e, { rede: c.rede, hospital: h, ...a(id) })) !== null) avisos++;
            return { id, sinais, avisos };
          },
          programarReavaliacao: (x) => programarReavaliacaoSgh(e, { hospital: h, ...x }),
          dispensarReavaliacao: (x) => dispensarReavaliacaoSgh(e, { hospital: h, ...x }),
          publicarRegra: (x) => publicarRegraEscoreSgh(e, { hospital: h, ...x }),
          classificar: (x) => classificarPacienteSgh(e, { hospital: h, ...x }),
          registrarIndice: (x) => registrarIndiceUtiSgh(e, { hospital: h, ...x }),
          validarIndice: (x) => validarIndiceUtiSgh(e, { hospital: h, ...x }),
          estornarRegistro: (x) => estornarRegistroSgh(e, { hospital: h, ...x }),
          decidirProfilaxia: (x) => decidirProfilaxiaTevSgh(e, { hospital: h, ...x }),
          retificarProfilaxia: (x) => retificarProfilaxiaTevSgh(e, { hospital: h, ...x }),
          prescreverContencao: (x) => prescreverContencaoSgh(e, { hospital: h, ...x }),
          checarContencao: (x) => checarContencaoSgh(e, { hospital: h, ...x }),
          adendoChecagemContencao: (x) => adendoChecagemContencaoSgh(e, { hospital: h, ...x }),
          encerrarContencao: (x) => encerrarContencaoSgh(e, { hospital: h, ...x }),
          acionarTrr: (x) => acionarTrrSgh(e, { hospital: h, ...x }),
          eventoTrr: (x) => registrarEventoTrrSgh(e, { hospital: h, ...x }),
          gravarFichaPcr: (x) => gravarFichaPcrSgh(e, { hospital: h, ...x }),
          retificarEventoTrr: (x) => retificarEventoTrrSgh(e, { hospital: h, ...x }),
          inativarTrr: (x) => inativarTrrSgh(e, { hospital: h, ...x }),
          incluirProtocoloInternado: (x) => incluirProtocoloInternadoSgh(e, { hospital: h, ...x }),
          eventoProtocoloInternado: (x) => registrarEventoProtocoloInternadoSgh(e, { hospital: h, ...x }),
          registrarLesao: (x) => registrarLesaoSgh(e, { hospital: h, ...x }),
          versaoLesao: (x) => gravarVersaoLesaoSgh(e, { hospital: h, ...x }),
          curativoLesao: (x) => registrarCurativoSgh(e, { hospital: h, ...x }),
          corrigirCurativoLesao: (x) => corrigirCurativoSgh(e, { hospital: h, ...x }),
          fotoLesao: (x) => anexarFotoLesaoSgh(e, { hospital: h, ...x }),
          encerrarLesao: (x) => encerrarLesaoSgh(e, { hospital: h, ...x }),
          inativarLesao: (x) => inativarLesaoSgh(e, { hospital: h, ...x }),
          avisar: async (xs) => {
            let k = 0;
            for (const a of xs) if ((await gravarAviso(e, { rede: c.rede, hospital: h, ...a })) !== null) k++;
            return k;
          },
        });
        await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
        return r;
      });
    },
    regras: (c) => ler(c, (l) => regrasEscorePublicadas(l, c.hospital)),
    // W0-03: o histórico traz o estorno de cada registro (inativo e visível).
    escores: (c, ps, desde) =>
      ler(c, async (l) => {
        const xs = await escoresDosPacientes(l, c.hospital, ps, desde);
        const est = await estornosDosRegistros(
          l,
          c.hospital,
          'escore',
          xs.map((x) => x.id),
        );
        return xs.map((x) => ({ ...x, estorno: est.get(x.id) ?? null }));
      }),
    ultimosEscores: (c, ps, desde) => ler(c, (l) => ultimosEscoresDosPacientes(l, c.hospital, ps, desde)),
    reavaliacoes: (c, ps, desde) => ler(c, (l) => reavaliacoesDosPacientes(l, c.hospital, ps, desde)),
    escalasEmFormulario: (c, ps, desde) => ler(c, (l) => escalasEmFormulario(l, ps, desde)),
    internacoes: (c, regs) => ler(c, (l) => internacoesParaEscores(l, regs)),
    classificacoes: (c, u, d, t) =>
      ler(c, async (l) => {
        const xs = await classificacoesDaUnidade(l, c.hospital, u, d, t);
        const est = await estornosDosRegistros(
          l,
          c.hospital,
          'classificacao',
          xs.map((x) => x.id),
        );
        return xs.map((x) => ({ ...x, estorno: est.get(x.id) ?? null }));
      }),
    configuracaoIndices: (c) => ler(c, (l) => configuracaoIndicesUti(l)),
    indicesDoPaciente: (c, p) =>
      ler(c, async (l) => {
        const xs = await indicesUtiDoPaciente(l, c.hospital, p);
        const est = await estornosDosRegistros(
          l,
          c.hospital,
          'indiceUti',
          xs.map((x) => x.id),
        );
        return xs.map((x) => ({ ...x, estorno: est.get(x.id) ?? null }));
      }),
    // W0-03: o APACHE estornado não entra na SMR.
    apachesDoPeriodo: (c, de, ate) =>
      ler(c, async (l) => {
        const xs = await apachesValidadosDoPeriodo(l, c.hospital, de, ate);
        const est = await estornosDosRegistros(
          l,
          c.hospital,
          'indiceUti',
          xs.map((x) => x.id),
        );
        return xs.filter((x) => !est.has(x.id));
      }),
    vinculo: (c, login) => ler(c, (l) => vinculoParaClassificacao(l, login)),
    registroParaEstorno: (c, o, id) => ler(c, (l) => registroParaEstorno(l, c.hospital, o, id)),
    decisoesProfilaxia: (c, ids) => ler(c, (l) => decisoesProfilaxiaTev(l, c.hospital, ids)),
    contencoes: (c, f) => ler(c, (l) => contencoesLidas(l, c.hospital, f)),
    contencao: (c, id) => ler(c, (l) => contencaoParaGravar(l, c.hospital, id)),
    acionamentosTrr: (c, f) => ler(c, (l) => acionamentosTrr(l, c.hospital, f)),
    escoresComTrr: (c, ids) => ler(c, (l) => escoresComTrr(l, c.hospital, ids)),
    versoesPcr: (c, f) => ler(c, (l) => versoesPcr(l, c.hospital, f)),
    acionamentosDosEscores: (c, ids) => ler(c, (l) => acionamentosDosEscores(l, c.hospital, ids)),
    protocolosInternados: (c, f) => ler(c, (l) => protocolosInternados(l, c.hospital, f)),
    protocoloInternado: (c, id) => ler(c, (l) => protocoloInternado(l, c.hospital, id)),
    lesoes: (c, f) => ler(c, (l) => lesoesSgh(l, c.hospital, f)),
    pacientesInternados: (c, de, ate) => ler(c, (l) => pacientesInternadosNoPeriodo(l, de, ate)),
    lesaoDoCurativo: (c, id) => ler(c, (l) => lesaoDoCurativoSgh(l, c.hospital, id)),
    censo: (c, de, ate) => ler(c, (l) => pacientesDiaDoCenso(l, c.hospital, de, ate)),
    pacientesDia: (c, unidade, de, ate) =>
      ler(c, async (l) => {
        const r = await pacientesDiaDoCenso(l, c.hospital, de, ate);
        return {
          pacientesDia: r.porSetor.find((x) => x.setor === unidade)?.pacientesDia ?? 0,
          diasFechados: r.diasFechados,
        };
      }),
  };
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaEscoresIndisponivel(): PortaEscores {
  return portaIndisponivel<PortaEscores>(METODOS_PORTA_ESCORES);
}
