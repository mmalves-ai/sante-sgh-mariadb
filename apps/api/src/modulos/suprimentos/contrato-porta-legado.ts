// Porta dos contratos com fornecedores (M55, etapa 3) sobre o núcleo do legado: leituras READ ONLY pelos repositórios
// de @sgh/legado; as gravações numa transação SGH_ com a SGH_TRILHA junto (o escritor só das SGH_). Em dev sobre a cópia
// compartilhada as gravações recusam (`sghSoLeitura`), como nos outros módulos. `portaContratoNaTransacao`: a mesma
// porta sobre UMA transação aberta (os testes de integração na cópia, desfeita).
import {
  alterarContratoSgh,
  buscarUsuariosGestao,
  candidatosVinculo,
  contratoPorId,
  centrosCustoEstoque,
  criarContratoSgh,
  detalharContrato,
  type Escritor,
  fornecedoresEstoque,
  gravarTrilha,
  type Leitor,
  listarContratos,
  type NucleoLegado,
  painelContratos,
  registrarEventoContratoSgh,
  somenteSgh,
  vincularContratoSgh,
} from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import { portaIndisponivel } from '../exames/public-api.js';
import { type GravadorContrato, METODOS_PORTA_CONTRATO, type PortaContrato } from './contrato-porta.js';

function gravador(e: Escritor, hospital: string): GravadorContrato {
  return {
    criar: (m) => criarContratoSgh(e, { hospital, ...m }),
    alterar: (m) => alterarContratoSgh(e, { hospital, ...m }),
    evento: (m) => registrarEventoContratoSgh(e, { hospital, ...m }),
    vincular: (m) => vincularContratoSgh(e, { hospital, ...m }),
  };
}

type Ler = <T>(c: ContextoPortaM18, fn: (l: Leitor) => Promise<T>) => Promise<T>;

function leituras(ler: Ler): Omit<PortaContrato, 'destino' | 'podeGravar' | 'executar' | 'gravarSgh'> {
  return {
    listar: (c, f) => ler(c, (l) => listarContratos(l, c.hospital, f)),
    detalhar: (c, id) => ler(c, (l) => detalharContrato(l, c.hospital, id)),
    painel: (c) => ler(c, (l) => painelContratos(l, c.hospital)),
    candidatos: (c, id) =>
      ler(c, async (l) => {
        const x = await contratoPorId(l, c.hospital, id);
        return x ? candidatosVinculo(l, c.hospital, x) : null;
      }),
    fornecedores: (c, termo) =>
      ler(c, async (l) => {
        const r = await fornecedoresEstoque(l, termo);
        return { itens: r.itens.map((f) => ({ codigo: f.codigo, nome: f.nome })), cortada: r.cortada };
      }),
    usuarios: (c, termo) =>
      ler(c, async (l) =>
        (await buscarUsuariosGestao(l, termo))
          .filter((u) => u.ativo && !u.bloqueado)
          .map((u) => ({ login: u.login, nome: u.nome })),
      ),
    centros: (c) =>
      ler(c, async (l) =>
        (await centrosCustoEstoque(l))
          .filter((x) => !x.tecnico)
          .map((x) => ({ codigo: x.codigo, nome: x.nome })),
      ),
  };
}

const semExecutor = () =>
  Promise.reject(
    new ErroProblema(
      'operacao-bloqueada',
      409,
      'Operação indisponível',
      'O contrato não grava pelo executor: o pedido e o título com contrato nascem nas telas de compras e de contas a pagar.',
    ),
  );

export function portaContratoLegado(
  nucleo: NucleoLegado,
  opcoes: { sghSoLeitura?: boolean } = {},
): PortaContrato {
  const ctx = (c: ContextoPortaM18) => ({ rede: c.rede, hospital: c.hospital, traceId: 'contrato' });
  return {
    destino: 'legado',
    podeGravar: async () => ({ pode: true, codigo: null, motivo: null }),
    executar: semExecutor,
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

/** A porta sobre uma transação aberta (testes de integração na cópia, desfeita no fim). */
export function portaContratoNaTransacao(e: Escritor): PortaContrato {
  return {
    destino: 'legado',
    podeGravar: async () => ({ pode: true, codigo: null, motivo: null }),
    executar: semExecutor,
    async gravarSgh(c, trilha, fn) {
      const r = await fn(gravador(e, c.hospital));
      await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
      return r;
    },
    ...leituras((_c, fn) => fn(e)),
  };
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaContratoIndisponivel(): PortaContrato {
  return portaIndisponivel<PortaContrato>(METODOS_PORTA_CONTRATO);
}
