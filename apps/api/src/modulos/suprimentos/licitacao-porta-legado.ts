// Porta do processo formal de compra (M55, etapa 4) sobre o núcleo do legado: leituras READ ONLY pelos repositórios de
// @sgh/legado; as gravações numa transação SGH_ com a SGH_TRILHA junto (o escritor só das SGH_). Em dev sobre a cópia
// compartilhada as gravações recusam (`sghSoLeitura`), como nos outros módulos. `portaLicitacaoNaTransacao`: a mesma
// porta sobre UMA transação aberta (os testes de integração na cópia, desfeita).
import {
  alterarLicitacaoSgh,
  avancarLicitacaoSgh,
  buscarUsuariosGestao,
  criarLicitacaoSgh,
  descartarPrecoLicitacaoSgh,
  detalharLicitacao,
  encerrarLicitacaoSgh,
  type Escritor,
  fornecedoresEstoque,
  gravarTrilha,
  homologarLicitacaoSgh,
  type Leitor,
  listarLicitacoes,
  type NucleoLegado,
  painelLicitacoes,
  pedidosMarcadosLicitacao,
  registrarDocumentoLicitacaoSgh,
  registrarEventoLicitacaoSgh,
  registrarPrecoLicitacaoSgh,
  registrarPropostaLicitacaoSgh,
  situacaoPropostaLicitacaoSgh,
  somenteSgh,
} from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import { portaIndisponivel } from '../exames/public-api.js';
import { type GravadorLicitacao, METODOS_PORTA_LICITACAO, type PortaLicitacao } from './licitacao-porta.js';

function gravador(e: Escritor, hospital: string): GravadorLicitacao {
  return {
    criar: (m) => criarLicitacaoSgh(e, { hospital, ...m }),
    alterar: (m) => alterarLicitacaoSgh(e, { hospital, ...m }),
    preco: (m) => registrarPrecoLicitacaoSgh(e, { hospital, ...m }),
    descartarPreco: (m) => descartarPrecoLicitacaoSgh(e, { hospital, ...m }),
    proposta: (m) => registrarPropostaLicitacaoSgh(e, { hospital, ...m }),
    situacaoProposta: (m) => situacaoPropostaLicitacaoSgh(e, { hospital, ...m }),
    avancar: (m) => avancarLicitacaoSgh(e, { hospital, ...m }),
    homologar: (m) => homologarLicitacaoSgh(e, { hospital, ...m }),
    encerrar: (m) => encerrarLicitacaoSgh(e, { hospital, ...m }),
    evento: (m) => registrarEventoLicitacaoSgh(e, { hospital, ...m }),
    documento: (m) => registrarDocumentoLicitacaoSgh(e, { hospital, ...m }),
  };
}

type Ler = <T>(c: ContextoPortaM18, fn: (l: Leitor) => Promise<T>) => Promise<T>;

function leituras(ler: Ler): Omit<PortaLicitacao, 'destino' | 'podeGravar' | 'executar' | 'gravarSgh'> {
  return {
    listar: (c, f) => ler(c, (l) => listarLicitacoes(l, c.hospital, f)),
    detalhar: (c, id, o) => ler(c, (l) => detalharLicitacao(l, c.hospital, id, o)),
    painel: (c) => ler(c, (l) => painelLicitacoes(l, c.hospital)),
    pedidosMarcados: (c) => ler(c, (l) => pedidosMarcadosLicitacao(l)),
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
  };
}

const semExecutor = () =>
  Promise.reject(
    new ErroProblema(
      'operacao-bloqueada',
      409,
      'Operação indisponível',
      'O processo de compra não grava pelo executor: o pedido de compra nasce na tela de compras e é ligado ao processo.',
    ),
  );

export function portaLicitacaoLegado(
  nucleo: NucleoLegado,
  opcoes: { sghSoLeitura?: boolean } = {},
): PortaLicitacao {
  const ctx = (c: ContextoPortaM18) => ({ rede: c.rede, hospital: c.hospital, traceId: 'licitacao' });
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
export function portaLicitacaoNaTransacao(e: Escritor): PortaLicitacao {
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
export function portaLicitacaoIndisponivel(): PortaLicitacao {
  return portaIndisponivel<PortaLicitacao>(METODOS_PORTA_LICITACAO);
}
