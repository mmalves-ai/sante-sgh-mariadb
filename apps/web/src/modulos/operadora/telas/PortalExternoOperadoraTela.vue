<!-- 08-SGO L114 (C3-027): o portal externo da operadora para quem tem a permissão operadora.portal.acessar e a conta
     ativa no portal. Beneficiário: cartão digital (o próprio ou um dependente), solicitações (segunda via, reembolso,
     alteração cadastral, a própria exclusão) e cancelamento antes da decisão. Contratante: solicitações da empresa e o
     envio do lote de exclusão com as linhas criticadas. Corretor: a conta (proposta e comissão ficam no comercial).
     O titular nunca sai da tela: o servidor usa a conta ativa do usuário. -->
<script setup lang="ts">
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import {
  type LinhaLote,
  type LoteExclusao,
  type SolicitacaoPortal,
  TIPOS_PORTAL,
  type TipoPortal,
  abrirSolicitacao,
  cancelarSolicitacao,
  enviarLote,
  lerCartao,
  lerItensMeuLote,
  lerMeusLotes,
  lerMinhaConta,
  lerMinhasSolicitacoes,
} from '../api-portais-operadora.js';
import { mensagensPortaisOperadora } from '../i18n-portais-operadora.js';

const { t } = useI18n({ useScope: 'local', messages: { 'pt-BR': mensagensPortaisOperadora } });
const rota = useRoute();
const portal = computed<TipoPortal>(() => {
  const p = String(rota.params['portal'] ?? '');
  return (TIPOS_PORTAL as readonly string[]).includes(p) ? (p as TipoPortal) : 'beneficiario';
});
const fila = useQueryClient();
const dataBr = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—');
const num = (v: string) => (v.trim() === '' ? null : Number(v));

const mensagem = ref<string | null>(null);
const recusa = ref<string | null>(null);
const erro = ref<unknown>(null);
function tratar(e: unknown): void {
  if (e instanceof ErroApi && e.problema?.detail && [400, 403, 404, 409, 422].includes(e.status))
    recusa.value = e.problema.detail;
  else erro.value = e;
}
async function gravar(acao: () => Promise<unknown>): Promise<boolean> {
  mensagem.value = recusa.value = erro.value = null;
  try {
    await acao();
    mensagem.value = t('gravado');
    await fila.invalidateQueries({ queryKey: ['portal-operadora', portal.value] });
    return true;
  } catch (e) {
    tratar(e);
    return false;
  }
}

const conta = useQuery({
  queryKey: computed(() => ['portal-operadora', portal.value, 'conta']),
  queryFn: () => lerMinhaConta(portal.value),
  retry: false,
});
const semConta = computed(() => conta.error.value instanceof ErroApi && conta.error.value.status === 403);
const ativa = computed(() => conta.data.value?.situacao === 'ativa');
const temSolicitacoes = computed(() => ativa.value && (conta.data.value?.tipos.length ?? 0) > 0);

// ---- cartão digital ----
const dependente = ref('');
const cartaoPedido = ref<number | null | undefined>(undefined);
const cartao = useQuery({
  queryKey: computed(() => ['portal-operadora', portal.value, 'cartao', cartaoPedido.value]),
  queryFn: () => lerCartao(cartaoPedido.value ?? null),
  enabled: computed(() => portal.value === 'beneficiario' && ativa.value && cartaoPedido.value !== undefined),
});
function verCartao(): void {
  mensagem.value = recusa.value = erro.value = null;
  cartaoPedido.value = num(dependente.value);
}

// ---- solicitações ----
const solicitacoes = useQuery({
  queryKey: computed(() => ['portal-operadora', portal.value, 'solicitacoes']),
  queryFn: () => lerMinhasSolicitacoes(portal.value),
  enabled: temSolicitacoes,
});
const opcoesTipo = computed(() =>
  (conta.data.value?.tipos ?? []).map((v) => ({ valor: v, rotulo: t(`tipos.${v}`) })),
);
const nova = reactive({
  tipo: '',
  beneficiario: '',
  motivo: '',
  dataEfeito: '',
  pedidoReembolso: '',
  observacao: '',
});
const pedeMotivo = computed(() => nova.tipo === 'exclusao_beneficiario');
const pedeData = computed(() =>
  ['exclusao_beneficiario', 'reativacao_beneficiario', 'inclusao_beneficiario'].includes(nova.tipo),
);
const faltaNova = computed(() => {
  const f: string[] = [];
  if (!nova.tipo) f.push(t('solicitacao.tipo'));
  if (pedeMotivo.value && !nova.motivo.trim()) f.push(t('externo.motivo'));
  if (pedeMotivo.value && !nova.dataEfeito) f.push(t('solicitacao.dataEfeito'));
  if (nova.tipo === 'reembolso' && !nova.pedidoReembolso.trim()) f.push(t('externo.pedidoReembolso'));
  return f;
});
async function enviarSolicitacao(): Promise<void> {
  const ok = await gravar(() =>
    abrirSolicitacao(portal.value, {
      tipo: nova.tipo,
      beneficiario: num(nova.beneficiario),
      motivo: pedeMotivo.value ? num(nova.motivo) : null,
      dataEfeito: pedeData.value && nova.dataEfeito ? nova.dataEfeito : null,
      pedidoReembolso: nova.tipo === 'reembolso' ? num(nova.pedidoReembolso) : null,
      dados: null,
      observacao: nova.observacao.trim() || null,
    }),
  );
  if (ok)
    Object.assign(nova, {
      tipo: '',
      beneficiario: '',
      motivo: '',
      dataEfeito: '',
      pedidoReembolso: '',
      observacao: '',
    });
}
const cancelar = (s: SolicitacaoPortal) => gravar(() => cancelarSolicitacao(portal.value, s.id, s.versao));

// ---- lote de exclusão (contratante) ----
const lotes = useQuery({
  queryKey: computed(() => ['portal-operadora', portal.value, 'lotes']),
  queryFn: lerMeusLotes,
  enabled: computed(() => portal.value === 'contratante' && ativa.value),
});
const loteAberto = ref<LoteExclusao | null>(null);
const itens = useQuery({
  queryKey: computed(() => ['portal-operadora', portal.value, 'lotes', 'itens', loteAberto.value?.id]),
  queryFn: () => lerItensMeuLote(loteAberto.value!.id),
  enabled: computed(() => loteAberto.value !== null),
});
const textoLote = ref('');
const linhasLote = computed<{ linhas: LinhaLote[]; invalida: number | null }>(() => {
  const linhas: LinhaLote[] = [];
  const brutas = textoLote.value
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
  for (const [i, l] of brutas.entries()) {
    const [matricula, motivo, data] = l.split(';').map((x) => x.trim());
    if (!matricula || !/^\d+$/.test(motivo ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(data ?? ''))
      return { linhas: [], invalida: i + 1 };
    linhas.push({ sequencia: i + 1, matricula, motivo: Number(motivo), dataEfeito: data! });
  }
  return { linhas, invalida: null };
});
async function enviarLoteExclusao(): Promise<void> {
  if (await gravar(() => enviarLote(linhasLote.value.linhas))) textoLote.value = '';
}
</script>

<template>
  <main class="tela" data-testid="tela-portal-operadora">
    <h1>{{ t('externo.titulo', { portal: t(`portais.${portal}`) }) }}</h1>
    <SanteAlerta
      v-if="semConta"
      :texto="t('externo.semConta')"
      variante="alerta"
      data-testid="portal-sem-conta"
    />
    <MensagemErro v-else-if="conta.error.value" :erro="conta.error.value" />
    <SanteAlerta v-if="mensagem" :texto="mensagem" variante="info" data-testid="portal-mensagem" />
    <SanteAlerta v-if="recusa" :texto="recusa" variante="alerta" data-testid="portal-recusa" />
    <MensagemErro v-if="erro" :erro="erro" />

    <template v-if="conta.data.value">
      <section class="bloco" aria-labelledby="portal-conta-t" data-testid="portal-conta">
        <h2 id="portal-conta-t">{{ t('externo.minhaConta') }}</h2>
        <p>
          {{ conta.data.value.login }} · {{ t(`situacoesConta.${conta.data.value.situacao}`) }}
          <span v-if="conta.data.value.email"> · {{ conta.data.value.email }}</span>
        </p>
        <p v-if="portal === 'corretor'">{{ t('externo.corretor') }}</p>
      </section>

      <section
        v-if="portal === 'beneficiario' && ativa"
        class="bloco"
        aria-labelledby="portal-cartao-t"
        data-testid="portal-cartao"
      >
        <h2 id="portal-cartao-t">{{ t('externo.cartao') }}</h2>
        <form class="campos" @submit.prevent="verCartao">
          <SanteCampoTexto
            id="portal-dependente"
            v-model="dependente"
            :rotulo="t('externo.dependente')"
            :max-bytes="18"
          />
          <SanteBotao :rotulo="t('externo.verCartao')" tipo="submit" data-testid="portal-ver-cartao" />
        </form>
        <dl v-if="cartao.data.value" class="cartao" data-testid="portal-cartao-dados">
          <dt>{{ t('lote.nome') }}</dt>
          <dd>{{ cartao.data.value.nome }}</dd>
          <dt>{{ t('lote.matricula') }}</dt>
          <dd>{{ cartao.data.value.matricula }}</dd>
          <dt>{{ t('externo.produto') }}</dt>
          <dd>{{ cartao.data.value.produto }}</dd>
          <dt>{{ t('externo.registroAns') }}</dt>
          <dd>{{ cartao.data.value.registroAns ?? '—' }}</dd>
          <dt>{{ t('externo.via') }}</dt>
          <dd>{{ cartao.data.value.via }}</dd>
          <dt>{{ t('externo.vigencia') }}</dt>
          <dd>
            {{
              t('externo.periodo', {
                de: dataBr(cartao.data.value.inicioVigencia),
                ate: dataBr(cartao.data.value.fimVigencia),
              })
            }}
          </dd>
        </dl>
        <SanteAlerta
          v-if="cartao.data.value"
          :texto="cartao.data.value.valido ? t('externo.valido') : t('externo.invalido')"
          :variante="cartao.data.value.valido ? 'info' : 'alerta'"
          data-testid="portal-cartao-validade"
        />
        <MensagemErro v-if="cartao.error.value" :erro="cartao.error.value" />
      </section>

      <section
        v-if="temSolicitacoes"
        class="bloco"
        aria-labelledby="portal-solic-t"
        data-testid="portal-solicitacoes"
      >
        <h2 id="portal-solic-t">{{ t('externo.minhasSolicitacoes') }}</h2>
        <table v-if="solicitacoes.data.value?.length" class="tabela">
          <thead>
            <tr>
              <th scope="col">{{ t('solicitacao.numero') }}</th>
              <th scope="col">{{ t('solicitacao.tipo') }}</th>
              <th scope="col">{{ t('solicitacao.beneficiario') }}</th>
              <th scope="col">{{ t('situacao') }}</th>
              <th scope="col">{{ t('solicitacao.criadaEm') }}</th>
              <th scope="col">{{ t('solicitacao.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in solicitacoes.data.value" :key="s.id" :data-testid="`portal-solic-${s.id}`">
              <td>{{ s.numero }}</td>
              <td>{{ t(`tipos.${s.tipo}`) }}</td>
              <td>{{ s.beneficiarioNome ?? '—' }}</td>
              <td>
                {{ t(`situacoesSolicitacao.${s.situacao}`) }}
                <span v-if="s.resultado"> ({{ s.resultado }})</span>
              </td>
              <td>{{ dataBr(s.criadaEm) }}</td>
              <td>
                <SanteBotao
                  v-if="s.situacao === 'aberta'"
                  :rotulo="t('externo.cancelar')"
                  variante="destrutivo"
                  :confirmacao="t('externo.confirmarCancelar')"
                  :data-testid="`portal-cancelar-${s.id}`"
                  @acionar="cancelar(s)"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else-if="solicitacoes.data.value" role="status">{{ t('nenhum') }}</p>

        <form class="bloco" aria-labelledby="portal-nova-t" @submit.prevent="enviarSolicitacao">
          <h3 id="portal-nova-t">{{ t('externo.nova') }}</h3>
          <div class="campos">
            <SanteSelecao
              v-model="nova.tipo"
              :rotulo="t('solicitacao.tipo')"
              :opcoes="opcoesTipo"
              obrigatorio
              data-testid="portal-nova-tipo"
            />
            <SanteCampoTexto
              id="portal-nova-beneficiario"
              v-model="nova.beneficiario"
              :rotulo="t('externo.beneficiario')"
              :max-bytes="18"
            />
            <SanteCampoTexto
              v-if="pedeMotivo"
              id="portal-nova-motivo"
              v-model="nova.motivo"
              :rotulo="t('externo.motivo')"
              :max-bytes="18"
            />
            <SanteData
              v-if="pedeData"
              v-model="nova.dataEfeito"
              :rotulo="t('solicitacao.dataEfeito')"
              editavel
            />
            <SanteCampoTexto
              v-if="nova.tipo === 'reembolso'"
              id="portal-nova-reembolso"
              v-model="nova.pedidoReembolso"
              :rotulo="t('externo.pedidoReembolso')"
              :max-bytes="18"
            />
            <SanteCampoTexto
              id="portal-nova-observacao"
              v-model="nova.observacao"
              :rotulo="t('externo.observacao')"
              :max-bytes="2000"
              multilinha
            />
          </div>
          <p v-if="faltaNova.length" role="status">{{ t('falta', { lista: faltaNova.join(', ') }) }}</p>
          <SanteBotao
            :rotulo="t('externo.enviar')"
            tipo="submit"
            :desabilitado="faltaNova.length > 0"
            data-testid="portal-nova-enviar"
          />
        </form>
      </section>

      <section
        v-if="portal === 'contratante' && ativa"
        class="bloco"
        aria-labelledby="portal-lotes-t"
        data-testid="portal-lotes"
      >
        <h2 id="portal-lotes-t">{{ t('externo.lotes') }}</h2>
        <table v-if="lotes.data.value?.length" class="tabela">
          <thead>
            <tr>
              <th scope="col">{{ t('lote.numero') }}</th>
              <th scope="col">{{ t('situacao') }}</th>
              <th scope="col">{{ t('lote.aceitos') }}</th>
              <th scope="col">{{ t('lote.rejeitados') }}</th>
              <th scope="col">{{ t('lote.recebidoEm') }}</th>
              <th scope="col">{{ t('solicitacao.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="l in lotes.data.value" :key="l.id" :data-testid="`portal-lote-${l.id}`">
              <td>{{ l.numero }}</td>
              <td>{{ l.situacao }}</td>
              <td>{{ l.aceitos }}</td>
              <td>{{ l.rejeitados }}</td>
              <td>{{ dataBr(l.recebidoEm) }}</td>
              <td>
                <SanteBotao
                  :rotulo="t('lote.itens')"
                  variante="secundario"
                  :data-testid="`portal-lote-itens-${l.id}`"
                  @acionar="loteAberto = l"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else-if="lotes.data.value" role="status">{{ t('nenhum') }}</p>
        <table v-if="loteAberto && itens.data.value" class="tabela" data-testid="portal-lote-linhas">
          <caption>
            {{
              t('lote.linhasDoLote', { numero: loteAberto.numero })
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('lote.sequencia') }}</th>
              <th scope="col">{{ t('lote.matricula') }}</th>
              <th scope="col">{{ t('situacao') }}</th>
              <th scope="col">{{ t('lote.critica') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="i in itens.data.value" :key="i.sequencia">
              <td>{{ i.sequencia }}</td>
              <td>{{ i.matricula ?? '—' }}</td>
              <td>{{ i.situacao }}</td>
              <td>{{ i.critica ?? '—' }}</td>
            </tr>
          </tbody>
        </table>
        <form class="bloco" aria-labelledby="portal-novo-lote-t" @submit.prevent="enviarLoteExclusao">
          <h3 id="portal-novo-lote-t">{{ t('externo.novoLote') }}</h3>
          <SanteCampoTexto
            id="portal-lote-texto"
            v-model="textoLote"
            :rotulo="t('externo.linhasLote')"
            :max-bytes="200000"
            multilinha
          />
          <p v-if="linhasLote.invalida" role="status" data-testid="portal-lote-invalida">
            {{ t('externo.linhaInvalida', { linha: linhasLote.invalida }) }}
          </p>
          <SanteBotao
            :rotulo="t('externo.enviarLote')"
            tipo="submit"
            :desabilitado="linhasLote.linhas.length === 0"
            data-testid="portal-lote-enviar"
          />
        </form>
      </section>
    </template>
  </main>
</template>

<style scoped>
.tela {
  display: grid;
  gap: 1rem;
  padding: 1rem;
}
.campos {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: end;
}
.cartao {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 0.25rem 1rem;
}
.tabela {
  width: 100%;
  border-collapse: collapse;
}
</style>
