<script setup lang="ts">
// "LGPD: consentimentos, titulares e anonimização" (M10, ficha seção 7; cap-08 §8.13): pedidos do titular com
// protocolo e prazo de 15 dias (SGH_AUD_PEDIDO_TITULAR); confirmar a identidade, atender ou negar com o
// fundamento legal. Eliminação de prontuário é negada pela guarda legal (o domínio só aceita negar com esse
// fundamento). O titular é identificado pelo PRONTUÁRIO (o número que o hospital usa; o servidor acha o paciente e
// recusa o prontuário inexistente ou repetido), nunca pelo ID interno. Abaixo, as tabelas da privacidade pelo
// cadastro genérico, só consulta.
import {
  CANAIS_PEDIDO,
  FUNDAMENTOS_PEDIDO,
  type PedidoTitularTela,
  TIPOS_PEDIDO_TITULAR,
  tipoDoProblema,
} from '@sgh/contratos';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { SanteAlerta, SanteBotao, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import DominiosIndiceTela from '../../config/telas/DominiosIndiceTela.vue';
import { buscarPedidos, registrarPedido, tratarPedido } from '../api.js';

type Tipo = (typeof TIPOS_PEDIDO_TITULAR)[number];
type Canal = (typeof CANAIS_PEDIDO)[number];
type Fundamento = (typeof FUNDAMENTOS_PEDIDO)[number];

const { t } = useI18n();
const cliente = useQueryClient();
const consulta = useQuery({ queryKey: ['adm', 'pedidos'], queryFn: () => buscarPedidos() });
const podeTratar = computed(() => pode('auditoria.pedidoTitular.tratar'));
const aviso = ref('');
const recusa = ref('');
const erro = ref<unknown>(null);

const dialogo = ref(false);
const novo = ref<{ paciente: string; tipo: Tipo; canal: Canal; descricao: string }>({
  paciente: '',
  tipo: 'acesso',
  canal: 'presencial',
  descricao: '',
});
const fundamento = ref<Record<string, Fundamento>>({});

function tratarErro(e: unknown): void {
  if (e instanceof ErroApi && e.problema && tipoDoProblema(e.problema) === 'recusa-de-negocio')
    recusa.value = e.problema.detail ?? e.problema.title ?? '';
  else erro.value = e;
}
function limpar(): void {
  aviso.value = '';
  recusa.value = '';
  erro.value = null;
}
async function registrar(): Promise<void> {
  limpar();
  try {
    const r = await registrarPedido({
      prontuario: Number(novo.value.paciente),
      tipo: novo.value.tipo,
      canal: novo.value.canal,
      ...(novo.value.descricao.trim() ? { descricao: novo.value.descricao.trim() } : {}),
    });
    dialogo.value = false;
    aviso.value = t('adm.privacidade.registrado', { protocolo: r.protocolo });
    await cliente.invalidateQueries({ queryKey: ['adm', 'pedidos'] });
  } catch (e) {
    tratarErro(e);
  }
}
async function tratar(
  p: PedidoTitularTela,
  acao: 'confirmar-identidade' | 'atender' | 'negar',
): Promise<void> {
  limpar();
  try {
    await tratarPedido(p.id, {
      acao,
      ...(acao === 'negar' ? { fundamento: fundamento.value[p.id] ?? 'outro' } : {}),
    });
    aviso.value = t('adm.comum.gravado');
    await cliente.invalidateQueries({ queryKey: ['adm', 'pedidos'] });
  } catch (e) {
    tratarErro(e);
  }
}
const opcoesFundamento = computed(() =>
  FUNDAMENTOS_PEDIDO.map((f) => ({ valor: f, rotulo: t(`adm.privacidade.fundamentos.${f}`) })),
);
const opcoesTipo = computed(() =>
  TIPOS_PEDIDO_TITULAR.map((x) => ({ valor: x, rotulo: t(`adm.privacidade.tipos.${x}`) })),
);
const opcoesCanal = computed(() =>
  CANAIS_PEDIDO.map((x) => ({ valor: x, rotulo: t(`adm.privacidade.canais.${x}`) })),
);
const aberto = (p: PedidoTitularTela) => p.situacao === 'aberto' || p.situacao === 'identidade-verificada';
</script>

<template>
  <section class="tela" aria-labelledby="privacidade-titulo">
    <h1 id="privacidade-titulo">{{ t('adm.privacidade.titulo') }}</h1>
    <p>{{ t('adm.privacidade.texto') }}</p>
    <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="privacidade-aviso" />
    <SanteAlerta v-if="recusa" :texto="recusa" variante="aviso" anunciar data-testid="privacidade-recusa" />
    <MensagemErro v-if="erro" :erro="erro" />
    <SanteBotao
      v-if="podeTratar"
      :rotulo="t('adm.privacidade.novo')"
      data-testid="novo-pedido"
      @acionar="dialogo = true"
    />
    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <p v-else-if="consulta.isPending.value">{{ t('adm.comum.carregando') }}</p>
    <template v-else-if="consulta.data.value">
      <p role="status">
        {{
          t('adm.privacidade.abertos', { n: consulta.data.value.abertos, a: consulta.data.value.atrasados })
        }}
      </p>
      <div class="rolagem" tabindex="0" role="region" :aria-label="t('adm.comum.rolagem')">
        <table data-testid="tabela-pedidos">
          <caption>
            {{
              t('adm.privacidade.titulo')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('adm.privacidade.protocolo') }}</th>
              <th scope="col">{{ t('adm.privacidade.tipo') }}</th>
              <th scope="col">{{ t('adm.privacidade.prontuario') }}</th>
              <th scope="col">{{ t('adm.privacidade.situacao') }}</th>
              <th scope="col">{{ t('adm.privacidade.prazo') }}</th>
              <th v-if="podeTratar" scope="col">{{ t('adm.privacidade.fundamento') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="consulta.data.value.itens.length === 0">
              <td :colspan="podeTratar ? 6 : 5">{{ t('adm.comum.nenhum') }}</td>
            </tr>
            <tr v-for="p in consulta.data.value.itens" :key="p.id" :data-testid="`pedido-${p.protocolo}`">
              <th scope="row">{{ p.protocolo }}</th>
              <td>
                {{ t(`adm.privacidade.tipos.${p.tipo}`) }} · {{ t(`adm.privacidade.canais.${p.canal}`) }}
              </td>
              <td>{{ p.prontuario ?? '—' }}</td>
              <td>
                {{ t(`adm.privacidade.situacoes.${p.situacao}`) }}
                <span v-if="p.fundamento"> ({{ t(`adm.privacidade.fundamentos.${p.fundamento}`) }})</span>
              </td>
              <td>
                {{ p.prazo }}<strong v-if="p.atrasado"> · {{ t('adm.privacidade.atrasado') }}</strong>
              </td>
              <td v-if="podeTratar">
                <div v-if="aberto(p)" class="acoes">
                  <SanteBotao
                    v-if="p.situacao === 'aberto'"
                    :rotulo="t('adm.privacidade.confirmar')"
                    variante="secundario"
                    :data-testid="`confirmar-${p.protocolo}`"
                    @acionar="tratar(p, 'confirmar-identidade')"
                  />
                  <SanteBotao
                    v-if="p.situacao === 'identidade-verificada'"
                    :rotulo="t('adm.privacidade.atender')"
                    :data-testid="`atender-${p.protocolo}`"
                    @acionar="tratar(p, 'atender')"
                  />
                  <SanteSelecao
                    :id="`fund-${p.id}`"
                    :model-value="fundamento[p.id] ?? null"
                    @update:model-value="(v: Fundamento | null) => v && (fundamento[p.id] = v)"
                    :rotulo="t('adm.privacidade.fundamento')"
                    :ocultar-rotulo="true"
                    :opcoes="opcoesFundamento"
                  />
                  <SanteBotao
                    :rotulo="t('adm.privacidade.negar')"
                    variante="texto"
                    :data-testid="`negar-${p.protocolo}`"
                    @acionar="tratar(p, 'negar')"
                  />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
    <h2>{{ t('adm.privacidade.dominios') }}</h2>
    <DominiosIndiceTela subitem="privacidade" :embutido="true" />
    <SanteDialogo v-model:visivel="dialogo" :titulo="t('adm.privacidade.novo')">
      <form class="form" data-testid="form-pedido" @submit.prevent="registrar">
        <div class="campo">
          <label for="ped-paciente">{{ t('adm.privacidade.paciente') }}</label>
          <input
            id="ped-paciente"
            v-model="novo.paciente"
            inputmode="numeric"
            pattern="\d+"
            required
            data-testid="ped-paciente"
          />
        </div>
        <div class="campo">
          <SanteSelecao
            id="ped-tipo"
            v-model="novo.tipo"
            :rotulo="t('adm.privacidade.tipo')"
            :opcoes="opcoesTipo"
            data-testid="ped-tipo"
          />
        </div>
        <div class="campo">
          <SanteSelecao
            id="ped-canal"
            v-model="novo.canal"
            :rotulo="t('adm.privacidade.canal')"
            :opcoes="opcoesCanal"
          />
        </div>
        <div class="campo">
          <label for="ped-descricao">{{ t('adm.privacidade.descricao') }}</label>
          <textarea id="ped-descricao" v-model="novo.descricao" maxlength="1000" rows="3" />
        </div>
        <div class="acoes">
          <SanteBotao :rotulo="t('adm.comum.salvar')" tipo="submit" data-testid="registrar-pedido" />
          <SanteBotao :rotulo="t('adm.comum.cancelar')" variante="texto" @acionar="dialogo = false" />
        </div>
      </form>
    </SanteDialogo>
  </section>
</template>

<style scoped>
.acoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-1);
  align-items: center;
}
.form,
.campo {
  display: grid;
  gap: var(--sgh-espaco-2);
}
.rolagem {
  overflow-x: auto;
}
table {
  border-collapse: collapse;
  width: 100%;
}
caption {
  text-align: left;
  font-weight: 600;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
input,
textarea {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
</style>
