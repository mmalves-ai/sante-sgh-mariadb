<script setup lang="ts">
// Ficha do usuário > "Papéis" > "Registro no conselho" (W1-01, parte 11d; vínculo usuário–profissional): os registros
// de conselho do papel ativo, a última conferência de cada (situação, dia, fonte), o efeito nos atos privativos pela
// regra do estabelecimento e o histórico. "Registrar conferência" pede a senha no diálogo único; cada conferência é um
// registro novo (as anteriores continuam visíveis). Ninguém confere o próprio registro. A consulta automática ao
// conselho fica desligada (o motivo vem do servidor).
import { type ConselhoUsuarioTela, FONTES_CONSELHO_TELA, SITUACOES_CONSELHO_TELA } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteDialogoGravacao, SanteSelecao, type PedidoGravacao } from '@sgh/ui';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { buscarConselhoUsuario, conferirConselhoUsuario } from '../api.js';

const props = defineProps<{ login: string }>();
const P = 'adm.ficha.conselho';
const { t } = useI18n();

const tela = ref<ConselhoUsuarioTela | null>(null);
const erro = ref<unknown>(null);
const carregando = ref(false);
const dialogo = ref(false);
const ocupado = ref(false);
const feito = ref(false);

const hoje = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const registro = ref('');
const situacao = ref<string>('ativo');
const conferidoEm = ref(hoje());
const fonte = ref<string>('portal-conselho');
const observacao = ref('');

async function carregar(): Promise<void> {
  carregando.value = true;
  erro.value = null;
  try {
    tela.value = await buscarConselhoUsuario(props.login);
    if (!registro.value && tela.value.registros[0]) registro.value = String(tela.value.registros[0].registro);
  } catch (e) {
    erro.value = e;
  } finally {
    carregando.value = false;
  }
}
watch(
  () => props.login,
  () => void carregar(),
  { immediate: true },
);

const rotuloRegistro = (r: ConselhoUsuarioTela['registros'][number]) =>
  [r.sigla, r.numero, r.uf].filter(Boolean).join(' ') || t(`${P}.registro`) + ` ${r.registro}`;
const opcoesRegistro = computed(() =>
  (tela.value?.registros ?? []).map((r) => ({ valor: String(r.registro), rotulo: rotuloRegistro(r) })),
);
const opcoesSituacao = computed(() =>
  SITUACOES_CONSELHO_TELA.map((s) => ({ valor: s, rotulo: t(`${P}.situacoes.${s}`) })),
);
const opcoesFonte = computed(() =>
  FONTES_CONSELHO_TELA.map((f) => ({ valor: f, rotulo: t(`${P}.fontes.${f}`) })),
);
const dia = (x: string) => x.split('-').reverse().join('/');
const valido = computed(
  () =>
    !!registro.value &&
    /^\d{4}-\d{2}-\d{2}$/.test(conferidoEm.value) &&
    conferidoEm.value <= hoje() &&
    observacao.value.trim().length >= 10,
);

const pedido = computed<PedidoGravacao | null>(() => ({
  titulo: t(`${P}.dialogo`, { login: props.login }),
  texto: t(`${P}.dialogoTexto`),
  senha: true,
  confirmar: t(`${P}.confirmar`),
  gravar: async ({ senha }) => {
    const r = await conferirConselhoUsuario(
      props.login,
      {
        registro: Number(registro.value),
        situacao: situacao.value as (typeof SITUACOES_CONSELHO_TELA)[number],
        conferidoEm: conferidoEm.value,
        fonte: fonte.value as (typeof FONTES_CONSELHO_TELA)[number],
        observacao: observacao.value.trim(),
      },
      senha,
    );
    tela.value = r.tela;
  },
}));
function concluido(): void {
  feito.value = true;
  observacao.value = '';
}
function falhou(e: unknown): void {
  erro.value = e;
}
function abrir(): void {
  feito.value = false;
  erro.value = null;
  dialogo.value = true;
}
</script>

<template>
  <section class="cartao conselho" aria-labelledby="ficha-conselho" data-testid="ficha-conselho">
    <h2 id="ficha-conselho" class="cartao__titulo">{{ t(`${P}.titulo`) }}</h2>
    <p class="nota">{{ t(`${P}.texto`) }}</p>
    <MensagemErro v-if="erro" :erro="erro" />
    <p v-if="carregando && !tela">{{ t('adm.comum.carregando') }}</p>
    <template v-if="tela">
      <p class="nota" data-testid="ficha-conselho-regra">
        {{ t(`${P}.regra.${tela.parametros.bloqueio}`, { dias: tela.parametros.validadeDias }) }}
      </p>
      <p class="nota" data-testid="ficha-conselho-automatica">
        {{ tela.parametros.motivoConsultaAutomatica }}
      </p>
      <p v-if="tela.registros.length === 0" data-testid="ficha-conselho-sem-registro">
        {{ t(`${P}.semRegistro`) }}
      </p>
      <template v-else>
        <SanteAlerta
          v-if="!tela.atosPrivativos"
          :texto="t(`${P}.atosBloqueados`, { motivo: tela.motivoBloqueio ?? '' })"
          variante="aviso"
          data-testid="ficha-conselho-bloqueado"
        />
        <p v-else data-testid="ficha-conselho-liberado">{{ t(`${P}.atosLiberados`) }}</p>
        <table class="tabela-simples">
          <thead>
            <tr>
              <th scope="col">{{ t(`${P}.registro`) }}</th>
              <th scope="col">{{ t(`${P}.ultima`) }}</th>
              <th scope="col">{{ t(`${P}.situacao`) }}</th>
              <th scope="col">{{ t(`${P}.efeito`) }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="r in tela.registros"
              :key="r.registro"
              :data-testid="`ficha-conselho-reg-${r.registro}`"
            >
              <td>
                {{ rotuloRegistro(r) }}<template v-if="r.ocupacao"> · {{ r.ocupacao }}</template>
              </td>
              <td>
                {{
                  r.ultima
                    ? t(`${P}.ultimaTexto`, {
                        situacao: t(`${P}.situacoes.${r.ultima.situacao}`),
                        data: dia(r.ultima.conferidoEm),
                        fonte: t(`${P}.fontes.${r.ultima.fonte}`),
                      })
                    : t(`${P}.nenhuma`)
                }}
              </td>
              <td>
                <span :class="['pilula', r.estado === 'regular' ? 'pilula--ok' : 'pilula--neutra']">{{
                  t(`${P}.estado.${r.estado}`)
                }}</span>
              </td>
              <td>{{ r.liberaAtosPrivativos ? t(`${P}.libera`) : t(`${P}.bloqueia`) }}</td>
            </tr>
          </tbody>
        </table>

        <form
          v-if="tela.podeConferir"
          class="conselho__form"
          data-testid="ficha-conselho-form"
          @submit.prevent="abrir"
        >
          <SanteSelecao
            id="conselho-registro"
            v-model="registro"
            :rotulo="t(`${P}.registro`)"
            :opcoes="opcoesRegistro"
            data-testid="ficha-conselho-registro"
          />
          <SanteSelecao
            id="conselho-situacao"
            v-model="situacao"
            :rotulo="t(`${P}.situacao`)"
            :opcoes="opcoesSituacao"
            data-testid="ficha-conselho-situacao"
          />
          <div class="conselho__campo">
            <label for="conselho-dia" class="rotulo">{{ t(`${P}.conferidoEm`) }}</label>
            <input
              id="conselho-dia"
              v-model="conferidoEm"
              type="date"
              :max="hoje()"
              required
              data-testid="ficha-conselho-dia"
            />
          </div>
          <SanteSelecao
            id="conselho-fonte"
            v-model="fonte"
            :rotulo="t(`${P}.fonte`)"
            :opcoes="opcoesFonte"
            data-testid="ficha-conselho-fonte"
          />
          <div class="conselho__campo conselho__campo--largo">
            <label for="conselho-obs" class="rotulo">{{ t(`${P}.observacao`) }}</label>
            <textarea
              id="conselho-obs"
              v-model="observacao"
              rows="2"
              maxlength="200"
              data-testid="ficha-conselho-observacao"
            />
          </div>
          <SanteBotao
            :rotulo="t(`${P}.conferir`)"
            tipo="submit"
            :desabilitado="!valido || ocupado"
            data-testid="ficha-conselho-conferir"
          />
        </form>
        <p v-else class="nota" data-testid="ficha-conselho-propria">{{ t(`${P}.propria`) }}</p>
        <p v-if="feito" role="status" data-testid="ficha-conselho-feito">{{ t(`${P}.feito`) }}</p>

        <template v-if="tela.historico.length">
          <h3 class="conselho__sub">{{ t(`${P}.historico`) }}</h3>
          <ul class="lista-linhas" data-testid="ficha-conselho-historico">
            <li v-for="h in tela.historico" :key="h.id">
              <span
                >{{ dia(h.conferidoEm) }} · {{ t(`${P}.situacoes.${h.situacao}`) }} ·
                {{ t(`${P}.fontes.${h.fonte}`) }} · {{ h.observacao }}</span
              >
              <span class="nota">{{ t(`${P}.por`, { login: h.criadoPor }) }}</span>
            </li>
          </ul>
        </template>
      </template>
    </template>

    <SanteDialogoGravacao
      v-model:visivel="dialogo"
      v-model:ocupado="ocupado"
      :pedido="pedido"
      @feito="concluido"
      @falha="falhou"
    />
  </section>
</template>

<style scoped>
.conselho {
  display: grid;
  gap: var(--sgh-espaco-3);
}
.conselho__form {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: var(--sgh-espaco-2);
}
.conselho__campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
.conselho__campo--largo {
  flex: 1 1 18rem;
}
.conselho__sub {
  margin: 0;
  font-size: 1rem;
}
.tabela-simples {
  width: 100%;
  border-collapse: collapse;
}
.tabela-simples th,
.tabela-simples td {
  text-align: left;
  padding: var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
.nota {
  color: var(--sgh-texto-secundario);
}
</style>
