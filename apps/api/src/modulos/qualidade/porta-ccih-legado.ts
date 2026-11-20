// Porta da CCIH (M48, etapa 3) sobre o núcleo do legado: leituras READ ONLY pelos repositórios de @sgh/legado e as
// gravações só do novo (SGH_QUA_* da CCIH e SGH_INT_LEITO_ESTADO) numa transação SGH_ com a SGH_TRILHA junto (o
// escritor só das SGH_: nenhuma tabela do legado). Em dev sobre a cópia compartilhada, as gravações SGH_ são recusadas
// (`sghSoLeitura`), como nos outros módulos; a integração grava na cópia livre com ROLLBACK.
import * as L from '@sgh/legado';
import { type Escritor, gravarTrilha, type Leitor, type NucleoLegado, somenteSgh } from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import { portaIndisponivel } from '../exames/public-api.js';
import { type ContextoCcih, type GravadorCcih, METODOS_PORTA_CCIH, type PortaCcih } from './porta-ccih.js';

type Leituras = Omit<PortaCcih, 'destino' | 'podeGravar' | 'executar' | 'gravarSgh'>;

function gravador(e: Escritor, h: string): GravadorCcih {
  return {
    registrarDispositivo: (x) => L.registrarDispositivoSgh(e, { hospital: h, ...x }),
    retirarDispositivo: (x) => L.retirarDispositivoSgh(e, { hospital: h, ...x }),
    registrarIras: (x) => L.registrarIrasSgh(e, { hospital: h, ...x }),
    descartarIras: (x) => L.descartarIrasSgh(e, { hospital: h, ...x }),
    configurarAntimicrobiano: (x) => L.configurarAntimicrobianoSgh(e, { hospital: h, ...x }),
    liberarAntimicrobiano: (x) => L.liberarAntimicrobianoSgh(e, { hospital: h, ...x }),
    revisarAntimicrobiano: (x) => L.revisarAntimicrobianoSgh(e, { hospital: h, ...x }),
    definirPrecaucao: (x) => L.definirPrecaucaoSgh(e, { hospital: h, ...x }),
    encerrarPrecaucao: (x) => L.encerrarPrecaucaoSgh(e, { hospital: h, ...x }),
    registrarObservacaoMaos: (x) => L.registrarObservacaoMaosSgh(e, { hospital: h, ...x }),
    registrarConsumoAlcool: (x) => L.registrarConsumoAlcoolSgh(e, { hospital: h, ...x }),
    registrarSurto: (x) => L.registrarSurtoSgh(e, { hospital: h, ...x }),
    atualizarSurto: (x) => L.atualizarSurtoSgh(e, { hospital: h, ...x }),
    corrigirDispositivo: (x) => L.corrigirDispositivoSgh(e, { hospital: h, ...x }),
    registrarBundle: (x) => L.registrarBundleSgh(e, { hospital: h, ...x }),
    corrigirBundle: (x) => L.corrigirBundleSgh(e, { hospital: h, ...x }),
    estornarBundle: (x) => L.estornarBundleSgh(e, { hospital: h, ...x }),
    cancelarDispositivo: (x) => L.cancelarDispositivoSgh(e, { hospital: h, ...x }),
    corrigirIras: (x) => L.corrigirIrasSgh(e, { hospital: h, ...x }),
    alterarPrecaucao: (x) => L.alterarPrecaucaoSgh(e, { hospital: h, ...x }),
    corrigirObservacaoMaos: (x) => L.corrigirObservacaoMaosSgh(e, { hospital: h, ...x }),
    estornarObservacaoMaos: (x) => L.estornarObservacaoMaosSgh(e, { hospital: h, ...x }),
    fecharCompetencia: (x) =>
      L.fecharCompetenciaQua(e, {
        hospital: h,
        area: 'ccih',
        competencia: x.competencia,
        agora: L.horaLocal(x.agora),
        usuario: x.usuario,
      }),
    reabrirCompetencia: (x) =>
      L.reabrirCompetenciaQua(e, {
        hospital: h,
        id: x.id,
        versao: x.versao,
        motivo: x.justificativa,
        agora: L.horaLocal(x.agora),
        usuario: x.usuario,
      }),
  };
}

function leituras(ler: <T>(c: ContextoCcih, fn: (l: Leitor) => Promise<T>) => Promise<T>): Leituras {
  return {
    relogio: async (c) => (await ler(c, (l) => L.relogioRecepcao(l))).agora.slice(0, 19),
    unidades: (c) => ler(c, (l) => L.unidadesParaNotificacao(l)),
    internados: (c) => ler(c, (l) => L.internadosParaCcih(l)),
    internacao: (c, reg) => ler(c, (l) => L.internacaoParaCcih(l, reg)),
    altasDas: (c, regs) => ler(c, (l) => L.altasDasInternacoes(l, regs)),
    vizinhos: (c, leito) => ler(c, (l) => L.vizinhosDoLeito(l, leito)),
    antimicrobianos: (c, regs, desde) => ler(c, (l) => L.antimicrobianosDasInternacoes(l, regs, desde)),
    antimicrobianoPrescrito: (c, id) => ler(c, (l) => L.antimicrobianoPrescrito(l, id)),
    vigencias: (c, de, ate) => ler(c, (l) => L.vigenciasAntimicrobianoNaCompetencia(l, de, ate)),
    consumoDispensado: (c, ano, mes) => ler(c, (l) => L.consumoAntimicrobianoDispensado(l, ano, mes)),
    itensAntimicrobianos: (c) => ler(c, (l) => L.itensAntimicrobianos(l)),
    itemDoCadastro: (c, item) => ler(c, (l) => L.itemDoCadastro(l, item)),
    fichas: (c, itens) => ler(c, (l) => L.fichasDosItensPrescritos(l, c.hospital, itens)),
    culturas: (c, regs, desde) => ler(c, (l) => L.culturasDasInternacoes(l, regs, desde)),
    exame: (c, id) => ler(c, (l) => L.exameParaCcih(l, id)),
    cirurgias: (c, regs, desde) => ler(c, (l) => L.cirurgiasDasInternacoes(l, regs, desde)),
    cirurgia: (c, id) => ler(c, (l) => L.cirurgiaParaCcih(l, id)),
    temperaturas: (c, pacientes, desde) =>
      ler(c, (l) => L.temperaturasDosPacientes(l, c.hospital, pacientes, desde)),
    censo: (c, de, ate) => ler(c, (l) => L.pacientesDiaDoCenso(l, c.hospital, de, ate)),
    tiposSurto: (c) => ler(c, (l) => L.tiposDeSurto(l)),
    dispositivo: (c, id) => ler(c, (l) => L.dispositivoSgh(l, c.hospital, id)),
    dispositivosDas: (c, regs) => ler(c, (l) => L.dispositivosDasInternacoesSgh(l, c.hospital, regs)),
    bundles: (c, ids) => ler(c, (l) => L.bundlesDosDispositivosSgh(l, c.hospital, ids)),
    bundle: (c, id) => ler(c, (l) => L.bundleSgh(l, c.hospital, id)),
    buscarProfissionais: (c, texto) => ler(c, (l) => L.buscarProfissionais(l, texto)),
    profissionaisPorRegistro: (c, ids) => ler(c, (l) => L.profissionaisPorRegistro(l, ids)),
    dispositivosNoPeriodo: (c, de, ate) => ler(c, (l) => L.dispositivosNoPeriodoSgh(l, c.hospital, de, ate)),
    iras: (c, id) => ler(c, (l) => L.irasSgh(l, c.hospital, id)),
    irasDas: (c, regs) => ler(c, (l) => L.irasDasInternacoesSgh(l, c.hospital, regs)),
    irasNoPeriodo: (c, de, ate) => ler(c, (l) => L.irasNoPeriodoSgh(l, c.hospital, de, ate)),
    itensConfigurados: (c) => ler(c, (l) => L.itensAntimicrobianoSgh(l, c.hospital)),
    liberacao: (c, id) => ler(c, (l) => L.liberacaoSgh(l, c.hospital, id)),
    liberacoesDos: (c, itens) => ler(c, (l) => L.liberacoesDosItensSgh(l, c.hospital, itens)),
    precaucao: (c, id) => ler(c, (l) => L.precaucaoSgh(l, c.hospital, id)),
    precaucoesAbertas: (c) => ler(c, (l) => L.precaucoesAbertasSgh(l, c.hospital)),
    precaucoesDa: (c, reg) => ler(c, (l) => L.precaucoesDaInternacaoSgh(l, c.hospital, reg)),
    observacoesMaos: (c, de, ate) => ler(c, (l) => L.observacoesMaosSgh(l, c.hospital, de, ate)),
    consumoAlcool: (c, comp) => ler(c, (l) => L.consumoAlcoolSgh(l, c.hospital, comp)),
    surto: (c, id) => ler(c, (l) => L.surtoSgh(l, c.hospital, id)),
    surtos: (c, desde) => ler(c, (l) => L.surtosSgh(l, c.hospital, desde)),
    sessoesMaos: (c, de, ate) => ler(c, (l) => L.observacoesMaosSgh(l, c.hospital, de, ate, true)),
    observacaoMaos: (c, id) => ler(c, (l) => L.observacaoMaosSgh(l, c.hospital, id)),
    versoes: (c, tabela, id) => ler(c, (l) => L.versoesQua(l, c.hospital, tabela, id)),
    competencias: (c, comps) => ler(c, (l) => L.competenciasQua(l, c.hospital, 'ccih', comps)),
    dependentes: (c, tabela, id) => ler(c, (l) => L.dependentesQualidade(l, c.hospital, tabela, id)),
  };
}

export function portaCcihLegado(nucleo: NucleoLegado, opcoes: { sghSoLeitura?: boolean } = {}): PortaCcih {
  const ctx = (c: ContextoCcih) => ({ rede: c.rede, hospital: c.hospital, traceId: 'ccih' });
  return {
    destino: 'legado',
    // Operações só do novo: nenhuma receita do executor (a liberação é a da funcionalidade, pela chave).
    podeGravar: async () => ({ pode: true, codigo: null, motivo: null }),
    executar: (_c, op) => Promise.reject(new Error(`Operação ${op} sem receita do executor: só SGH_.`)),
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
        const r = await fn(gravador(e, c.hospital));
        await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
        return r;
      });
    },
    ...leituras((c, fn) => nucleo.lerSomente(ctx(c), fn)),
  };
}

/**
 * A mesma porta sobre UMA transação já aberta (a integração na cópia, desfeita no fim): leituras e gravações SGH_ na
 * mesma transação, com a trilha junto; `hospital` troca o estabelecimento da sessão sintética pelo da cópia.
 */
export function portaCcihNaTransacao(e: Escritor, hospital: string): PortaCcih {
  const naCopia = (c: ContextoCcih): ContextoCcih => ({ ...c, hospital });
  const base = leituras((_c, fn) => fn(e));
  const l = Object.fromEntries(
    Object.entries(base).map(([k, f]) => [
      k,
      (c: ContextoCcih, ...r: unknown[]) => (f as (...a: unknown[]) => unknown)(naCopia(c), ...r),
    ]),
  ) as Leituras;
  return {
    destino: 'legado',
    podeGravar: async () => ({ pode: true, codigo: null, motivo: null }),
    executar: (_c, op) => Promise.reject(new Error(`Operação ${op} sem receita do executor: só SGH_.`)),
    async gravarSgh(_c, trilha, fn) {
      const s = somenteSgh(e);
      const r = await fn(gravador(s, hospital));
      const linha = typeof trilha === 'function' ? trilha(r) : trilha;
      await gravarTrilha(s, { ...linha, hospital });
      return r;
    },
    ...l,
  };
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaCcihIndisponivel(): PortaCcih {
  return portaIndisponivel<PortaCcih>(METODOS_PORTA_CCIH);
}
