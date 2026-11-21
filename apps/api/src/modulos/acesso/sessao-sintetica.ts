// Sessão SINTÉTICA para a casca (M07) em dev/ci: usada só quando NÃO há sessão real (cookie). Nunca existe
// em homolog, treino ou produção. Mantida só para os testes (ficha do M05). Nenhum dado de pessoa real.
// Com o núcleo real (a cópia, que tem dados reais) em AMBIENTE=dev, só com a marca explícita
// SESSAO_SINTETICA=sim (o E2E passa): o `pnpm dev` contra a cópia pede login (revisão do M06).
import { ESCOPOS_SEM_RESTRICAO, type Sessao } from '@sgh/contratos';
import type { Ambiente, NomeAmbiente } from '@sgh/nucleo';
import { lerRedePadrao } from '../../sessao/rede.js';
import { lerEstabelecimentosSinteticos } from './estabelecimentos-sinteticos.js';
import { calcularAutorizacao } from '../../autorizacao/servico-autorizacao.js';
import { CONCESSOES_VAZIAS } from './fonte-sintetica.js';

export const AMBIENTES_COM_SESSAO_SINTETICA = ['dev', 'ci'] as const satisfies readonly NomeAmbiente[];
export const USUARIO_SINTETICO = {
  id: 'sintetico',
  nome: 'Usuário sintético (desenvolvimento)',
  login: 'SINT.USUARIO',
} as const;
export const BLOQUEIO_PADRAO_SEGUNDOS = 15 * 60;

export class SessaoSintetica {
  private ativo: string | null;
  private readonly autorizacao = calcularAutorizacao(
    {
      concessoes: { ...CONCESSOES_VAZIAS, papeis: [0, 1, 4], opcoesPapel: [5429, 5433, 5437] },
      escopos: ESCOPOS_SEM_RESTRICAO,
      restricaoVinculo: false,
      perfisConcedidos: [],
      mapaPerfis: [],
    },
    Date.now(),
  );

  constructor(
    private readonly env: Ambiente,
    private readonly opcoes: { readonly nucleoReal?: boolean } = {},
  ) {
    this.ativo = this.estabelecimentos()[0]?.codigo ?? null;
  }

  disponivel(): boolean {
    const ambiente = this.env['AMBIENTE']?.trim() ?? '';
    if (!(AMBIENTES_COM_SESSAO_SINTETICA as readonly string[]).includes(ambiente)) return false;
    if (ambiente === 'dev' && this.opcoes.nucleoReal) return this.env['SESSAO_SINTETICA']?.trim() === 'sim';
    return true;
  }

  private estabelecimentos() {
    return lerEstabelecimentosSinteticos(this.env).map((e) => ({ codigo: e.codigo, nome: e.nome }));
  }

  atual(): Sessao {
    const bloqueio = Number(this.env['SESSAO_BLOQUEIO_SEGUNDOS'] ?? BLOQUEIO_PADRAO_SEGUNDOS);
    return {
      usuario: { ...USUARIO_SINTETICO },
      rede: lerRedePadrao(this.env),
      estabelecimentos: this.estabelecimentos(),
      estabelecimentoAtivo: this.ativo,
      unidades: [],
      unidadeAtiva: null,
      papeis: [],
      // M06: as permissões vêm do MESMO cálculo da sessão real (concessão → perfis → segregação), sobre
      // concessões sintéticas: papéis SBIS Administrador do sistema (1) e Gestor de acessos (0), que abrem
      // as telas de coexistência (M02 a M04, M09) e as de acesso (M06), mais os recursos de toda pessoa.
      permissoes: [...this.autorizacao.permissoes],
      escopos: this.autorizacao.escopos,
      perfil: this.autorizacao.perfil,
      restricaoVinculo: false,
      sintetica: true,
      bloqueioInatividadeSegundos:
        Number.isInteger(bloqueio) && bloqueio >= 0 ? bloqueio : BLOQUEIO_PADRAO_SEGUNDOS,
      avisoInatividadeSegundos: 0,
      bloqueada: false,
      expiraEm: '',
      ultimoAcesso: { em: null, falhasDesde: 0 },
      termoPendente: false,
      trocaSenha: null,
      trocaSenhaPeloNovo: false,
      segundoFator: { cadastrado: false, disponivel: false },
      reautenticacaoValidaAte: null,
    };
  }

  trocar(codigo: string): Sessao | null {
    if (!this.estabelecimentos().some((e) => e.codigo === codigo)) return null;
    this.ativo = codigo;
    return this.atual();
  }
}
