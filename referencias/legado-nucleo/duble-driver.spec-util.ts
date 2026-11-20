// Dublê do driver Firebird para os testes unitários do núcleo (nada conecta a banco).
import type {
  ConexaoFirebird,
  DestinoConexao,
  DriverFirebird,
  Linha,
  ModoTransacao,
  OpcoesConsulta,
  ResultadoConsulta,
  TransacaoFirebird,
} from './driver.js';

export type Responder = (
  sql: string,
  parametros: readonly unknown[],
  ctx: { destino: DestinoConexao; cancelado: () => boolean },
) => Linha[] | Promise<Linha[]>;

export interface DubleDriver extends DriverFirebird {
  readonly conexoes: DubleConexao[];
  readonly modos: ModoTransacao[];
  falharConexao: boolean;
}

export interface DubleConexao extends ConexaoFirebird {
  readonly destino: DestinoConexao;
  cancelamentos: number;
  fechada: boolean;
  quebrar(): void;
}

/**
 * Como o pedido de cancelamento chega ao dublê (trilha revisão, 18/11/2026):
 * - 'imediato' (padrão): derruba o comando em curso; sem comando em curso, só marca.
 * - 'pendente': o comando em curso já foi respondido pelo servidor (não é derrubado); o pedido fica armado no anexo
 *   e cai no PRÓXIMO comando (consulta, escrita ou COMMIT), como o fb_cancel_operation que chega com a conexão ociosa.
 * - 'perdido': o pedido sai, mas o comando seguinte passa (não dá para saber se ele ainda vai cair).
 */
export type ModoCancelamentoDuble = 'imediato' | 'pendente' | 'perdido';

export function criarDubleDriver(
  responder: Responder = () => [],
  opcoes: { readonly cancelamento?: ModoCancelamentoDuble } = {},
): DubleDriver {
  const modoCancelamento = opcoes.cancelamento ?? 'imediato';
  const conexoes: DubleConexao[] = [];
  const modos: ModoTransacao[] = [];
  const driver: DubleDriver = {
    nome: 'duble',
    conexoes,
    modos,
    falharConexao: false,
    async conectar(destino) {
      if (driver.falharConexao) throw new Error('connection refused');
      let cancelar: (() => void) | null = null;
      let cancelado = false;
      let armado = false;
      let valida = true;
      // Pedido armado no anexo cai no próximo comando e é consumido por ele.
      const cairArmado = () => {
        if (!armado) return;
        armado = false;
        throw new Error('operation was cancelled');
      };
      const conexao: DubleConexao = {
        destino,
        cancelamentos: 0,
        fechada: false,
        get valida() {
          return valida && !conexao.fechada;
        },
        quebrar() {
          valida = false;
        },
        async iniciar(modo) {
          modos.push(modo);
          cancelado = false;
          let aberta = true;
          const tr: TransacaoFirebird = {
            async consultar(sql, parametros, opcoes: OpcoesConsulta): Promise<ResultadoConsulta> {
              cairArmado();
              const linhas = await new Promise<Linha[]>((resolve, reject) => {
                cancelar = () => reject(new Error('operation was cancelled'));
                Promise.resolve(responder(sql, parametros, { destino, cancelado: () => cancelado })).then(
                  resolve,
                  reject,
                );
              });
              cancelar = null;
              const estourou = linhas.length > opcoes.teto;
              return { linhas: linhas.slice(0, opcoes.teto), estourou };
            },
            async executar(sql, parametros) {
              // Escrita passa pelo responder (cancelável, como a consulta): permite simular trava presa.
              cairArmado();
              await new Promise<unknown>((resolve, reject) => {
                cancelar = () => reject(new Error('operation was cancelled'));
                Promise.resolve(responder(sql, parametros, { destino, cancelado: () => cancelado })).then(
                  resolve,
                  reject,
                );
              });
              cancelar = null;
              return 1;
            },
            async executarRetornando(sql, parametros) {
              const linhas = await responder(sql, parametros, { destino, cancelado: () => cancelado });
              return linhas[0] ?? {};
            },
            async lerBlob(blob) {
              return Buffer.from(String(blob), 'latin1');
            },
            async confirmar() {
              cairArmado();
              aberta = false;
            },
            async desfazer() {
              if (!aberta) return;
              aberta = false;
            },
          };
          return tr;
        },
        async cancelar() {
          conexao.cancelamentos++;
          cancelado = true;
          if (modoCancelamento === 'pendente') armado = true;
          else if (modoCancelamento === 'imediato') cancelar?.();
        },
        async fechar() {
          conexao.fechada = true;
        },
      };
      conexoes.push(conexao);
      return conexao;
    },
    async encerrar() {},
  };
  return driver;
}

/** Ambiente de teste com N estabelecimentos fictícios (valores fictícios, senha vazia). */
export function ambienteFicticio(
  codigos: readonly string[],
  extra: Record<string, string> = {},
): Record<string, string> {
  const env: Record<string, string> = {
    AMBIENTE: 'dev',
    REDE_PADRAO: 'rede-teste',
    ESTABELECIMENTOS: codigos.join(','),
  };
  codigos.forEach((c, i) => {
    const C = c.toUpperCase();
    env[`FB_${C}_HOST`] = '127.0.0.1';
    env[`FB_${C}_PORTA`] = String(3351 + i);
    env[`FB_${C}_BANCO`] = `/var/lib/firebird/data/${c}.fdb`;
    env[`FB_${C}_USUARIO`] = 'SGH_DEV';
    env[`FB_${C}_SENHA`] = '';
    env[`FB_${C}_NOME`] = `Estabelecimento ${C} (exemplo)`;
  });
  return { ...env, ...extra };
}
