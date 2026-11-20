// Porta de cargos e salários sobre o núcleo do legado (W0-06, parte 4): leituras numa transação curta READ ONLY no
// banco do estabelecimento da sessão; gravações SGH_PES_* numa transação SGH_ (`somenteSgh`: nenhuma tabela do outro
// sistema) com a SGH_TRILHA junto. Em dev sobre a cópia compartilhada, as gravações são recusadas com o motivo
// (`sghSoLeitura`): a prova da gravação é a integração, sob a trava da cópia e desfeita. `portaCargosNaTransacao`: a
// mesma porta sobre UMA transação aberta (integração na cópia, desfeita). Nenhuma operação do executor.
import {
  alterarCargoPesSgh,
  buscarCboPesSgh,
  cargoPesSgh,
  cboPorCodigoPesSgh,
  conselhosPesSgh,
  contarDependenciasPesSgh,
  correcoesPesSgh,
  type Escritor,
  excluirCargosPesSgh,
  faixaSalarialPesSgh,
  faixasSalariaisPesSgh,
  gravarTrilha,
  incluirCargoPesSgh,
  incluirFaixaSalarialPesSgh,
  incluirVagaQuadroPesSgh,
  type Leitor,
  listarCargosPesSgh,
  type NucleoLegado,
  ocupacaoCargosPesSgh,
  registrarCorrecaoPesSgh,
  relogioRecepcao,
  situacaoCargosPesSgh,
  somenteSgh,
  vagaQuadroPesSgh,
  vagasQuadroPesSgh,
  versionarFaixaSalarialPesSgh,
  versionarVagaQuadroPesSgh,
} from '@sgh/legado';
import { ErroProblema } from '../../../problema.filter.js';
import { portaIndisponivel } from '../../exames/public-api.js';
import {
  type ContextoCargos,
  type GravadorCargos,
  METODOS_PORTA_CARGOS,
  type PortaCargos,
} from './porta-cargos.js';

type Ler = <T>(c: ContextoCargos, fn: (l: Leitor) => Promise<T>) => Promise<T>;

function leituras(ler: Ler): Omit<PortaCargos, 'destino' | 'podeGravar' | 'executar' | 'gravarSgh'> {
  return {
    hoje: (c) => ler(c, async (l) => (await relogioRecepcao(l)).hoje),
    cargos: (c) => ler(c, (l) => listarCargosPesSgh(l, c.hospital)),
    cargo: (c, id) => ler(c, (l) => cargoPesSgh(l, c.hospital, id)),
    faixas: (c, cargo) => ler(c, (l) => faixasSalariaisPesSgh(l, c.hospital, cargo)),
    faixa: (c, id) => ler(c, (l) => faixaSalarialPesSgh(l, c.hospital, id)),
    vagas: (c, cargo) => ler(c, (l) => vagasQuadroPesSgh(l, c.hospital, cargo)),
    vaga: (c, id) => ler(c, (l) => vagaQuadroPesSgh(l, c.hospital, id)),
    ocupacao: (c) => ler(c, (l) => ocupacaoCargosPesSgh(l, c.hospital)),
    dependencias: (c, alvo, id) => ler(c, (l) => contarDependenciasPesSgh(l, alvo, c.hospital, id)),
    buscarCbo: (c, t) => ler(c, (l) => buscarCboPesSgh(l, t)),
    cboPorCodigo: (c, cs) =>
      cs.length === 0 ? Promise.resolve(new Map()) : ler(c, (l) => cboPorCodigoPesSgh(l, cs)),
    conselhos: (c) => ler(c, (l) => conselhosPesSgh(l)),
    correcoes: (c, t, ids) =>
      ids.length === 0 ? Promise.resolve([]) : ler(c, (l) => correcoesPesSgh(l, c.hospital, t, ids)),
  };
}

function gravador(e: Escritor, c: ContextoCargos): GravadorCargos {
  const h = c.hospital;
  return {
    cargo: (id) => cargoPesSgh(e, h, id),
    faixa: (id) => faixaSalarialPesSgh(e, h, id),
    vaga: (id) => vagaQuadroPesSgh(e, h, id),
    incluirCargo: (x) => incluirCargoPesSgh(e, { hospital: h, ...x }),
    alterarCargo: (x) => alterarCargoPesSgh(e, { hospital: h, ...x }),
    situacao: (x) => situacaoCargosPesSgh(e, { hospital: h, ...x }),
    excluir: (x) => excluirCargosPesSgh(e, { hospital: h, ...x }),
    incluirFaixa: (x) => incluirFaixaSalarialPesSgh(e, { hospital: h, ...x }),
    versionarFaixa: (x) => versionarFaixaSalarialPesSgh(e, { hospital: h, ...x }),
    incluirVaga: (x) => incluirVagaQuadroPesSgh(e, { hospital: h, ...x }),
    versionarVaga: (x) => versionarVagaQuadroPesSgh(e, { hospital: h, ...x }),
    registrarCorrecao: (x) => registrarCorrecaoPesSgh(e, { hospital: h, ...x }),
  };
}

const recusaSoLeitura = () =>
  Promise.reject(
    new ErroProblema(
      'recurso-desligado',
      403,
      'Gravação desligada neste ambiente',
      'Neste ambiente de desenvolvimento o banco é só de leitura: cargos e salários não gravam.',
      { codigo: 'somente-leitura' },
    ),
  );

const semExecutor = () =>
  Promise.reject(
    new ErroProblema('recusa-de-negocio', 409, 'Operação recusada', 'Cargos e salários não usam o executor.'),
  );

export function portaCargosLegado(
  nucleo: Pick<NucleoLegado, 'lerSomente'> & Partial<Pick<NucleoLegado, 'gravarSgh'>>,
  opcoes: { sghSoLeitura?: boolean } = {},
): PortaCargos {
  const ctx = (c: ContextoCargos) => ({ rede: c.rede, hospital: c.hospital, traceId: 'cargos' });
  return {
    destino: 'legado',
    podeGravar: async () => ({ pode: true, codigo: null, motivo: null }),
    executar: semExecutor,
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
export function portaCargosNaTransacao(e: Escritor): PortaCargos {
  return {
    destino: 'legado',
    podeGravar: async () => ({ pode: true, codigo: null, motivo: null }),
    executar: semExecutor,
    async gravarSgh(c, trilha, fn) {
      const s = somenteSgh(e);
      const r = await fn(gravador(s, c));
      await gravarTrilha(s, typeof trilha === 'function' ? trilha(r) : trilha);
      return r;
    },
    ...leituras((_c, fn) => fn(e)),
  };
}

export function portaCargosIndisponivel(): PortaCargos {
  return portaIndisponivel<PortaCargos>(METODOS_PORTA_CARGOS);
}
