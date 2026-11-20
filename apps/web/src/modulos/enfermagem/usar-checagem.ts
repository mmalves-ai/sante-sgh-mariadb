// O envio da checagem (em tela e no tablet) com a regra sem rede (ficha do M25, regra 8): com rede, vai ao servidor
// com a chave do ato; sem rede (o navegador diz offline ou o pedido não chegou), o ato vai cifrado para a fila do
// aparelho com a hora real e a mesma chave, e a fila é enviada na ordem quando a rede volta. A fila é lida ao abrir a
// tela e a cada mudança de conexão.
import type { HorarioEnfermagem } from '@sgh/contratos';
import { computed, onBeforeUnmount, onMounted, ref, type Ref } from 'vue';
import { checar, novaChave, semRede, sincronizar, type ResultadoSincronizacao } from './api-enfermagem.js';
import type { DonoCofre } from './cofre-local.js';
import {
  type AtoNaFila,
  corpoDaSincronizacao,
  enfileirar,
  lerFila,
  resolvidos,
  retirar,
} from './fila-offline.js';

/**
 * A hora real do ato no relógio do estabelecimento (AAAA-MM-DDTHH:mm): o aparelho guarda a diferença entre o relógio
 * dele e o do servidor (lido com os horários) e a aplica, então o fuso do aparelho não importa.
 */
export function horaDoEstabelecimento(desvioMs: number, agora = Date.now()): string {
  return new Date(agora + desvioMs).toISOString().slice(0, 16);
}

/** A diferença entre o relógio do estabelecimento (hora local lida do servidor) e o do aparelho. */
export function desvioDoRelogio(agoraServidor: string, agora = Date.now()): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(agoraServidor)) return 0;
  const s = Date.parse(`${agoraServidor.slice(0, 16)}:00Z`);
  return Number.isFinite(s) ? s - agora : 0;
}

const CHAVE_APARELHO = 'sgh.enfermagem.aparelho';

/** Guarda neste navegador o identificador dado pela autorização do aparelho (lista de aparelhos). */
export function guardarIdentificadorDoAparelho(identificador: string): boolean {
  try {
    globalThis.localStorage?.setItem(CHAVE_APARELHO, identificador.slice(0, 64));
    return globalThis.localStorage?.getItem(CHAVE_APARELHO) === identificador.slice(0, 64);
  } catch {
    return false;
  }
}

/**
 * O identificador deste aparelho para a sincronização (sem dado de paciente; fica neste navegador): o da autorização
 * quando o aparelho foi autorizado nele; senão, um provisório (recusado quando a exigência de aparelho está ligada).
 */
export function identificadorDoAparelho(): string {
  const K = CHAVE_APARELHO;
  try {
    const lido = globalThis.localStorage?.getItem(K);
    if (lido) return lido;
    const novo = `web-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`.slice(
      0,
      64,
    );
    globalThis.localStorage?.setItem(K, novo);
    return novo;
  } catch {
    return 'web-sem-armazenamento';
  }
}

export function usarChecagem(
  dono: Ref<DonoCofre | null>,
  prazoHoras: Ref<number>,
  aoSincronizar: (r: ResultadoSincronizacao) => void = () => undefined,
) {
  const online = ref(globalThis.navigator?.onLine !== false);
  const fila = ref<AtoNaFila[]>([]);
  const ultimo = ref<ResultadoSincronizacao | null>(null);
  const enviando = ref(false);
  const pendentes = computed(() => fila.value.length);
  const desvio = ref(0);
  /** Acerta o relógio do ato pela hora do servidor (a de cada leitura dos horários). */
  function ajustarRelogio(agoraServidor: string): void {
    desvio.value = desvioDoRelogio(agoraServidor);
  }
  const horaReal = () => horaDoEstabelecimento(desvio.value);

  async function recarregarFila(): Promise<void> {
    fila.value = dono.value ? await lerFila(dono.value, prazoHoras.value) : [];
  }

  async function guardar(ato: AtoNaFila): Promise<void> {
    if (!dono.value) throw new Error('sem sessão');
    fila.value = await enfileirar(dono.value, ato, prazoHoras.value);
  }

  /** Checa com rede; sem rede, guarda. Devolve 'gravado' (com o resultado) ou 'guardado'. */
  async function enviarChecagem(h: HorarioEnfermagem, corpo: Record<string, unknown>, rotulo: string) {
    const chave = novaChave(`chk-${h.id}`);
    // Com rede, a hora do ato é a do banco; sem rede, a do aparelho acertada pelo relógio do estabelecimento.
    const comHora = { ...corpo, horaReal: horaReal() };
    if (online.value) {
      try {
        return {
          tipo: 'gravado' as const,
          resultado: await checar(h.id, { ...corpo, horaReal: null }, chave),
        };
      } catch (x) {
        if (!semRede(x)) throw x;
        online.value = false;
      }
    }
    await guardar({
      tipo: 'checagem',
      chave,
      horario: h.id,
      checagem: { ...comHora, origemOffline: true },
      rotulo,
    });
    return { tipo: 'guardado' as const };
  }

  /** Envia a fila na ordem (cada ato com a chave dele: reenviar não grava duas vezes). */
  async function enviarFila(): Promise<ResultadoSincronizacao | null> {
    if (!dono.value || enviando.value) return null;
    await recarregarFila();
    if (fila.value.length === 0) return null;
    enviando.value = true;
    try {
      const atos = [...fila.value];
      const r = await sincronizar(identificadorDoAparelho(), corpoDaSincronizacao(atos), novaChave('sync'));
      fila.value = await retirar(dono.value, resolvidos(r.resultados), prazoHoras.value);
      ultimo.value = r;
      aoSincronizar(r);
      return r;
    } catch (x) {
      if (semRede(x)) online.value = false;
      else throw x;
      return null;
    } finally {
      enviando.value = false;
    }
  }

  const aoOnline = () => {
    online.value = true;
    void enviarFila().catch(() => undefined);
  };
  const aoOffline = () => {
    online.value = false;
  };
  onMounted(() => {
    globalThis.addEventListener?.('online', aoOnline);
    globalThis.addEventListener?.('offline', aoOffline);
    void recarregarFila().then(() => (online.value ? enviarFila().catch(() => undefined) : null));
  });
  onBeforeUnmount(() => {
    globalThis.removeEventListener?.('online', aoOnline);
    globalThis.removeEventListener?.('offline', aoOffline);
  });

  return {
    online,
    fila,
    pendentes,
    ultimo,
    enviando,
    enviarChecagem,
    guardar,
    enviarFila,
    recarregarFila,
    ajustarRelogio,
    horaReal,
  };
}
