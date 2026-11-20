// Porta da lista de trabalho DICOM sobre o núcleo do legado (M47, etapa 3): cada leitura numa transação curta READ ONLY
// no banco do estabelecimento; as gravações só do novo (SGH_SADT_PACS_MWL, SGH_SADT_PACS_ESTUDO e a SGH_OUTBOX) numa
// transação SGH_ com a SGH_TRILHA junto (`somenteSgh` recusa qualquer escrita fora de SGH_). Em dev sobre a cópia
// compartilhada, as gravações são recusadas (`sghSoLeitura`). `portaPacsNaTransacao`: a mesma porta sobre UMA
// transação aberta (a integração na cópia, sempre desfeita).
import { EVENTO_OUTBOX_MWL } from '@sgh/contratos';
import {
  type Escritor,
  examesDoSetor,
  examesImagemSemItem,
  examesSadtPorId,
  gravarTrilha,
  itemMwl,
  itensMwlDoPaciente,
  itensMwlDosExames,
  type Leitor,
  lerParceiros,
  modalidadeDoCadastroDosExames,
  modalidadesDicom,
  type NucleoLegado,
  reenviarItemMwlSgh,
  registrarItemMwlSgh,
  registrarStatusEstudoSgh,
  relogioRecepcao,
  somenteSgh,
  statusDosExames,
  visualizadoresImagem,
} from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import { portaIndisponivel } from '../exames/public-api.js';
import { type ContextoPacs, type GravadorPacs, METODOS_PORTA_PACS, type PortaPacs } from './pacs-porta.js';

const naoExecuta = () =>
  Promise.reject(new Error('A lista de trabalho DICOM não usa receita do legado (operações só SGH_).'));

function gravador(e: Escritor, c: ContextoPacs): GravadorPacs {
  const x = somenteSgh(e);
  return {
    registrarItem: (r) => registrarItemMwlSgh(x, { hospital: c.hospital, rede: c.rede, ...r }),
    reenviar: (r) => reenviarItemMwlSgh(x, { hospital: c.hospital, rede: c.rede, ...r }),
    registrarStatus: (r) => registrarStatusEstudoSgh(x, { hospital: c.hospital, ...r }),
  };
}

type Ler = <T>(c: ContextoPacs, fn: (l: Leitor) => Promise<T>) => Promise<T>;

function leituras(ler: Ler): Omit<PortaPacs, 'destino' | 'podeGravar' | 'executar' | 'gravarSgh'> {
  return {
    relogio: (c) =>
      ler(c, async (l) => {
        const r = await relogioRecepcao(l);
        return { hoje: r.hoje, agora: r.agora.slice(0, 19).replace(' ', 'T') };
      }),
    examesDoDia: (c, data, f) =>
      ler(c, async (l) => {
        const r = await examesDoSetor(l, c.hospital, {
          setor: 'imagem',
          inicio: data,
          fim: data,
          ...(f?.ato ? { ato: f.ato } : {}),
          ...(f?.termo ? { termo: f.termo } : {}),
        });
        return { itens: r.itens, cortada: r.cortada };
      }),
    examesPorId: (c, ids) => ler(c, (l) => examesSadtPorId(l, c.hospital, ids)),
    examesSemItem: (c, f) => ler(c, (l) => examesImagemSemItem(l, c.hospital, f)),
    modalidades: (c) => ler(c, (l) => modalidadesDicom(l)),
    modalidadeDoCadastro: (c, ids) => ler(c, (l) => modalidadeDoCadastroDosExames(l, ids)),
    visualizadores: (c) => ler(c, (l) => visualizadoresImagem(l)),
    itens: (c, ids) => ler(c, (l) => itensMwlDosExames(l, c.hospital, ids)),
    item: (c, chave) => ler(c, (l) => itemMwl(l, c.hospital, chave)),
    itensDoPaciente: (c, paciente) => ler(c, (l) => itensMwlDoPaciente(l, c.hospital, paciente)),
    status: (c, ids) => ler(c, (l) => statusDosExames(l, c.hospital, ids)),
    parceiroDaWorklist: (c) =>
      ler(c, async (l) => {
        const p = (await lerParceiros(l, c.hospital)).find(
          (x) => x.ativo && x.eventos.includes(EVENTO_OUTBOX_MWL),
        );
        return p ? { codigo: p.codigo, nome: p.nome } : null;
      }),
  };
}

export function portaPacsLegado(
  nucleo: Pick<NucleoLegado, 'lerSomente' | 'gravarSgh'>,
  opcoes: { readonly sghSoLeitura?: boolean } = {},
): PortaPacs {
  const ctx = (c: ContextoPacs) => ({ rede: c.rede, hospital: c.hospital, traceId: 'sadt-pacs' });
  return {
    destino: 'legado',
    podeGravar: async () => ({ pode: true, codigo: null, motivo: null }),
    executar: naoExecuta,
    gravarSgh: (c, trilha, fn) => {
      if (opcoes.sghSoLeitura)
        return Promise.reject(
          new ErroProblema(
            'recurso-desligado',
            403,
            'Gravação desligada neste ambiente',
            'Neste ambiente de desenvolvimento o banco é só de leitura: a lista de trabalho não é gravada.',
            { codigo: 'somente-leitura' },
          ),
        );
      return nucleo.gravarSgh(ctx(c), async (e) => {
        const r = await fn(gravador(e, c));
        await gravarTrilha(somenteSgh(e), typeof trilha === 'function' ? trilha(r) : trilha);
        return r;
      });
    },
    ...leituras((c, fn) => nucleo.lerSomente(ctx(c), fn)),
  };
}

/** A porta sobre uma transação aberta (a integração na cópia, desfeita no fim). */
export function portaPacsNaTransacao(e: Escritor): PortaPacs {
  return {
    destino: 'legado',
    podeGravar: async () => ({ pode: true, codigo: null, motivo: null }),
    executar: naoExecuta,
    async gravarSgh(c, trilha, fn) {
      const r = await fn(gravador(e, c));
      await gravarTrilha(somenteSgh(e), typeof trilha === 'function' ? trilha(r) : trilha);
      return r;
    },
    ...leituras((_c, fn) => fn(e)),
  };
}

/** Fora de dev/ci sem o núcleo: 503 em tudo (falha fechada). */
export function portaPacsIndisponivel(): PortaPacs {
  return portaIndisponivel<PortaPacs>(METODOS_PORTA_PACS);
}
