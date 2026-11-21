// Avisos de mudança da fila do consultório e do quadro do PA (M20; ficha, seção 4: "vigia a cada 1-2 s"). O canal de
// eventos só diz "mudou" (o estabelecimento e uma versão; nunca a linha nem dado de pessoa) e a tela relê. Duas fontes:
//   - as gravações do M20 neste processo (abrir, chamar, atender, etapa, observação, desfecho, exclusão): o controlador
//     avisa depois do COMMIT;
//   - a outra ponta: o canal "senhas" do vigia de mudanças do M16 (uma consulta leve por ciclo de 1 a 2 s, qualquer que
//     seja o número de telas), que vê a chamada, o início e a liberação da senha gravados pelo outro sistema.
// Sem o vigia (testes) ou sem o canal (proxy, navegador), a tela relê sozinha (reserva). A batida do canal reconfere a
// sessão e a permissão: sessão encerrada ou permissão retirada fecha o canal (D-VIG-20).
import type { CanalVigia } from '@sgh/contratos';
import { criarAbility, pode, regrasDeAcesso } from '@sgh/dominio-acesso';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import type { ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { contextoDoEstabelecimento } from '../cadastro/contexto-nucleo.js';
import type { MotorVigia } from '../internacao/public-api.js';

export const AVISOS_ATENDIMENTO = Symbol('AVISOS_ATENDIMENTO');

type Ouvinte = (versao: number) => void;

export interface RespostaEventosAtendimento {
  hijack(): void;
  readonly raw: {
    writeHead(status: number, cabecalhos: Record<string, string>): void;
    write(texto: string): boolean;
    end(): void;
  };
}

export interface RequisicaoBrutaAtendimento {
  readonly raw?: { on(evento: 'close', fn: () => void): void };
}

export class AvisosAtendimento {
  private readonly ouvintes = new Map<string, Set<Ouvinte>>();
  private readonly versoes = new Map<string, number>();
  private readonly vigias = new Map<string, () => void>();
  private readonly abertos = new Set<{ end(): void }>();

  constructor(
    private readonly vigia: Pick<MotorVigia, 'assinar'> | null = null,
    /**
     * O canal do vigia que a outra ponta move ("senhas" no M20; "leitos" no mapa e na higienização do M21; "bloco" no
     * quadro do bloco do M46).
     */
    private readonly canal: CanalVigia = 'senhas',
  ) {}

  /** Escuta as mudanças do estabelecimento; o primeiro ouvinte liga o canal "senhas" do vigia, o último desliga. */
  assinar(hospital: string, ouvinte: Ouvinte): () => void {
    let lista = this.ouvintes.get(hospital);
    if (!lista) {
      lista = new Set();
      this.ouvintes.set(hospital, lista);
    }
    lista.add(ouvinte);
    if (this.vigia && !this.vigias.has(hospital))
      this.vigias.set(
        hospital,
        // O vigia escuta pelo cliente e pelo estabelecimento (id) da sessão.
        this.vigia.assinar(contextoDoEstabelecimento(hospital), this.canal, () => this.avisar(hospital)),
      );
    return () => {
      lista.delete(ouvinte);
      if (lista.size === 0) {
        this.vigias.get(hospital)?.();
        this.vigias.delete(hospital);
      }
    };
  }

  /** Uma mudança vista (gravação deste processo ou ciclo do vigia): todos os ouvintes do estabelecimento releem. */
  avisar(hospital: string): number {
    const v = (this.versoes.get(hospital) ?? 0) + 1;
    this.versoes.set(hospital, v);
    for (const o of [...(this.ouvintes.get(hospital) ?? [])]) {
      try {
        o(v);
      } catch {
        // Um canal com erro não derruba os outros.
      }
    }
    return v;
  }

  ouvintesDe(hospital: string): number {
    return this.ouvintes.get(hospital)?.size ?? 0;
  }

  /**
   * Abre o canal de eventos (text/event-stream) da requisição: "mudanca" a cada aviso; a batida mantém o caminho
   * aberto nos proxies e reconfere a sessão e a permissão (falhou: fecha; o navegador reconecta pela guarda).
   */
  abrirCanal(
    req: RequisicaoAutorizada & RequisicaoBrutaAtendimento,
    res: RespostaEventosAtendimento,
    hospital: string,
    permissao: string,
    resolvedor: ResolvedorSessao | null,
    batidaMs: number,
  ): void {
    res.hijack();
    res.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
      connection: 'keep-alive',
    });
    res.raw.write('retry: 3000\n\n');
    const cancelar = this.assinar(hospital, (versao) =>
      res.raw.write(`event: mudanca\ndata: ${JSON.stringify({ versao })}\n\n`),
    );
    let fechado = false;
    const encerrar = () => {
      if (fechado) return;
      fechado = true;
      clearInterval(batida);
      cancelar();
      this.abertos.delete(res.raw);
    };
    const batida = setInterval(() => {
      void sessaoVale(req, permissao, resolvedor).then((vale) => {
        if (fechado) return;
        if (vale) {
          res.raw.write(': batida\n\n');
          return;
        }
        encerrar();
        res.raw.end();
      });
    }, batidaMs);
    batida.unref?.();
    this.abertos.add(res.raw);
    req.raw?.on('close', encerrar);
  }

  /** Fecha os canais abertos (desligamento do servidor). */
  fecharTodos(): void {
    for (const r of this.abertos) r.end();
    this.abertos.clear();
  }
}

async function sessaoVale(
  req: RequisicaoAutorizada,
  permissao: string,
  resolvedor: ResolvedorSessao | null,
): Promise<boolean> {
  if (!resolvedor) return true;
  let r: Awaited<ReturnType<ResolvedorSessao['resolver']>>;
  try {
    r = await resolvedor.resolver(req);
  } catch {
    return true;
  }
  if (!r || r.sessao.bloqueada) return false;
  return pode(criarAbility(regrasDeAcesso(r.sessao.permissoes, r.sessao.escopos)), permissao);
}
