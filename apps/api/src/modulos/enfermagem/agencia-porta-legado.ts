// Porta da agência transfusional (M47, etapa 2) sobre o núcleo do legado: leituras READ ONLY pelos repositórios de
// @sgh/legado; as gravações só do novo (SGH_SADT_HEMO_IMUNO, _BOLSA e _BOLSA_MOV) numa transação SGH_ com a SGH_TRILHA
// junto (o escritor só das SGH_: nenhuma tabela do legado). Em dev sobre a cópia compartilhada, as gravações SGH_ são
// recusadas (`sghSoLeitura`), como nos outros módulos.
import {
  bolsaDoEstoque,
  bolsasDoEstoque,
  cadastrosDoEstoque,
  corrigirBolsaSgh,
  examesImunoLancados,
  gravarTrilha,
  imunoHematologias,
  invalidarImunoHematologiaSgh,
  type Leitor,
  liberarImunoHematologiaSgh,
  movimentarBolsaSgh,
  movimentosDaBolsa,
  type NucleoLegado,
  provasCruzadasDaRequisicao,
  receberBolsaSgh,
  registrarImunoHematologiaSgh,
  resultadosImunoDoPaciente,
  somenteSgh,
  versoesDaBolsa,
} from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import { portaIndisponivel } from '../exames/public-api.js';
import { type ContextoAgencia, METODOS_PORTA_AGENCIA, type PortaAgencia } from './agencia-porta.js';

export function portaAgenciaLegado(
  nucleo: NucleoLegado,
  opcoes: { sghSoLeitura?: boolean } = {},
): PortaAgencia {
  const ctx = (c: ContextoAgencia) => ({ rede: c.rede, hospital: c.hospital, traceId: 'agencia' });
  const ler = <T>(c: ContextoAgencia, fn: (l: Leitor) => Promise<T>) => nucleo.lerSomente(ctx(c), fn);
  return {
    destino: 'legado',
    // Operações só do novo: nenhuma receita do executor (a liberação é a da funcionalidade, pela chave).
    podeGravar: async () => ({ pode: true, codigo: null, motivo: null }),
    executar: (_c, op) => Promise.reject(new Error(`Operação ${op} sem receita do executor nesta porta.`)),
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
        const h = c.hospital;
        const r = await fn({
          registrarImuno: (x) => registrarImunoHematologiaSgh(e, { hospital: h, ...x }),
          liberarImuno: (x) => liberarImunoHematologiaSgh(e, { hospital: h, ...x }),
          invalidarImuno: (x) => invalidarImunoHematologiaSgh(e, { hospital: h, ...x }),
          receberBolsa: (x) => receberBolsaSgh(e, { hospital: h, ...x }),
          movimentarBolsa: (x) => movimentarBolsaSgh(e, { hospital: h, ...x }),
          corrigirBolsa: (x) => corrigirBolsaSgh(e, { hospital: h, ...x }),
        });
        await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
        return r;
      });
    },
    imunos: (c, f) =>
      ler(c, async (l) => {
        const r = await imunoHematologias(l, { hospital: c.hospital, ...f });
        return { itens: [...r.itens], cortada: r.cortada };
      }),
    resultadosDoPaciente: (c, p) =>
      ler(c, async (l) => [...(await resultadosImunoDoPaciente(l, c.hospital, p))]),
    provas: (c, r) => ler(c, async (l) => [...(await provasCruzadasDaRequisicao(l, c.hospital, r))]),
    estoque: (c, f) =>
      ler(c, async (l) => {
        const r = await bolsasDoEstoque(l, { hospital: c.hospital, ...f });
        return { itens: [...r.itens], cortada: r.cortada };
      }),
    bolsa: (c, k, agora) => ler(c, (l) => bolsaDoEstoque(l, c.hospital, k, agora)),
    movimentos: (c, b) => ler(c, async (l) => [...(await movimentosDaBolsa(l, c.hospital, b))]),
    versoesBolsa: (c, b) => ler(c, async (l) => [...(await versoesDaBolsa(l, c.hospital, b))]),
    cadastrosDoEstoque: (c) => ler(c, (l) => cadastrosDoEstoque(l)),
    examesLancados: (c, p, agora) => ler(c, async (l) => [...(await examesImunoLancados(l, p, agora))]),
  };
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaAgenciaIndisponivel(): PortaAgencia {
  return portaIndisponivel<PortaAgencia>(METODOS_PORTA_AGENCIA);
}
