<script setup lang="ts">
// Cobertura permanente do paciente (F3.1, 02-CAD linha 9): as carteiras na própria ficha, com a situação no dia, o aviso
// de carteira vencida ou a vencer e a carteira que o atendimento vai propor. Incluir numa linha só (a primeira já nasce
// principal), renovar a validade, marcar a principal e encerrar com motivo; nada é apagado. O servidor confere tudo de
// novo (regra no domínio); aqui a validação na hora só evita o vaivém.
import { SanteSelecao } from '@sgh/ui';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import {
  alterarCobertura,
  type Carteira,
  type Coberturas,
  encerrarCobertura,
  incluirCobertura,
  lerCoberturas,
  type Opcoes,
} from '../api-vinculos.js';

const props = defineProps<{ idPaciente: number; podeEditar: boolean; opcoes: Opcoes | null }>();

const { t } = useI18n();
const dados = ref<Coberturas | null>(null);
const erro = ref<unknown>(null);
const mensagem = ref('');
const novo = ref({
  fontePagadora: 0,
  plano: 0,
  numeroCarteira: '',
  validade: '',
  titular: true,
  titularNome: '',
  parentesco: 0,
});

const fonte = computed(() => props.opcoes?.fontes.find((f) => f.id === novo.value.fontePagadora) ?? null);
const planos = computed(
  () => props.opcoes?.planos.filter((p) => p.fontePagadora === novo.value.fontePagadora) ?? [],
);
const pendencias = computed(() => {
  const r: string[] = [];
  if (!fonte.value) r.push(t('vinculos.cobertura.falta.fonte'));
  else {
    if (!fonte.value.particular && !novo.value.numeroCarteira.trim())
      r.push(t('vinculos.cobertura.falta.carteira'));
    if (fonte.value.exigeValidade && !novo.value.validade) r.push(t('vinculos.cobertura.falta.validade'));
  }
  if (!novo.value.titular && (!novo.value.titularNome.trim() || !novo.value.parentesco))
    r.push(t('vinculos.cobertura.falta.titular'));
  return r;
});
const rotulo = (s: Carteira['situacaoNoDia']) => t(`vinculos.cobertura.situacoes.${s}`);

async function carregar(): Promise<void> {
  try {
    dados.value = await lerCoberturas(props.idPaciente);
  } catch (e) {
    erro.value = e;
  }
}
async function agir(fn: () => Promise<unknown>, ok: string): Promise<void> {
  erro.value = null;
  mensagem.value = '';
  try {
    await fn();
    mensagem.value = ok;
    await carregar();
  } catch (e) {
    erro.value = e;
  }
}
const incluir = () =>
  agir(
    () =>
      incluirCobertura(props.idPaciente, {
        fontePagadora: novo.value.fontePagadora,
        plano: novo.value.plano || null,
        numeroCarteira: novo.value.numeroCarteira.trim() || null,
        validade: novo.value.validade || null,
        titular: novo.value.titular,
        titularNome: novo.value.titular ? null : novo.value.titularNome.trim(),
        parentesco: novo.value.titular ? null : novo.value.parentesco || null,
      }).then(() => {
        novo.value = { ...novo.value, numeroCarteira: '', validade: '', plano: 0 };
      }),
    t('vinculos.cobertura.incluida'),
  );
const principal = (c: Carteira) =>
  agir(
    () => alterarCobertura(props.idPaciente, c.id, { versao: c.versao, principal: true }),
    t('vinculos.cobertura.trocada'),
  );
function renovar(c: Carteira): void {
  const validade = window.prompt(t('vinculos.cobertura.perguntaValidade'), c.validade ?? '');
  if (validade)
    void agir(
      () => alterarCobertura(props.idPaciente, c.id, { versao: c.versao, validade }),
      t('vinculos.cobertura.renovada'),
    );
}
function encerrar(c: Carteira): void {
  const motivo = window.prompt(t('vinculos.cobertura.perguntaMotivo'));
  if (motivo && motivo.trim().length >= 3)
    void agir(
      () => encerrarCobertura(props.idPaciente, c.id, c.versao, motivo.trim()),
      t('vinculos.cobertura.encerrada'),
    );
}
void carregar();
</script>

<template>
  <section aria-labelledby="sec-coberturas" data-testid="coberturas-paciente">
    <h2 id="sec-coberturas">{{ t('vinculos.cobertura.titulo') }}</h2>
    <MensagemErro v-if="erro" :erro="erro" />
    <p v-if="mensagem" role="status">{{ mensagem }}</p>
    <template v-if="dados">
      <ul v-if="dados.avisos.length" class="avisos" role="alert" data-testid="avisos-carteira">
        <li v-for="a in dados.avisos" :key="a.id" :data-codigo="a.codigo">{{ a.mensagem }}</li>
      </ul>
      <p v-if="dados.itens.length === 0">{{ t('vinculos.cobertura.nenhuma') }}</p>
      <table v-else>
        <thead>
          <tr>
            <th scope="col">{{ t('vinculos.cobertura.fontePlano') }}</th>
            <th scope="col">{{ t('vinculos.cobertura.carteira') }}</th>
            <th scope="col">{{ t('vinculos.cobertura.validade') }}</th>
            <th scope="col">{{ t('vinculos.cobertura.titular') }}</th>
            <th scope="col">{{ t('vinculos.cobertura.situacao') }}</th>
            <th scope="col">
              <span class="sr-only">{{ t('vinculos.comum.acoes') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in dados.itens" :key="c.id" :data-situacao="c.situacaoNoDia">
            <td>
              {{ c.fontePagadora.nome }}<template v-if="c.plano">{{ ` / ${c.plano.nome}` }}</template>
              <strong v-if="c.principal">{{ ` ${t('vinculos.cobertura.principal')}` }}</strong>
              <em v-if="dados.proposta === c.id">{{ ` ${t('vinculos.cobertura.proposta')}` }}</em>
            </td>
            <td>{{ c.numeroCarteira ?? '—' }}</td>
            <td>{{ c.validade ?? '—' }}</td>
            <td>{{ c.titular ? t('vinculos.cobertura.proprio') : c.titularNome }}</td>
            <td>{{ rotulo(c.situacaoNoDia) }}</td>
            <td v-if="podeEditar && c.situacaoNoDia !== 'encerrada'">
              <button v-if="!c.principal" type="button" @click="principal(c)">
                {{ t('vinculos.cobertura.tornarPrincipal') }}
              </button>
              <button type="button" @click="renovar(c)">{{ t('vinculos.cobertura.renovar') }}</button>
              <button type="button" @click="encerrar(c)">{{ t('vinculos.cobertura.encerrar') }}</button>
            </td>
          </tr>
        </tbody>
      </table>
      <form
        v-if="podeEditar && opcoes"
        class="nova-carteira"
        data-testid="nova-carteira"
        @submit.prevent="incluir"
      >
        <SanteSelecao
          v-model="novo.fontePagadora"
          :rotulo="t('vinculos.cobertura.fonte')"
          obrigatorio
          :opcoes="[
            { valor: 0, rotulo: t('vinculos.comum.escolha'), desabilitada: true },
            ...opcoes.fontes.map((f) => ({ valor: f.id, rotulo: f.nome })),
          ]"
        />
        <SanteSelecao
          v-if="planos.length"
          v-model="novo.plano"
          :rotulo="t('vinculos.cobertura.plano')"
          :opcoes="[
            { valor: 0, rotulo: t('vinculos.cobertura.semPlano') },
            ...planos.map((p) => ({ valor: p.id, rotulo: p.descricao })),
          ]"
        />
        <label v-if="!fonte?.particular"
          >{{ t('vinculos.cobertura.carteira') }} <input v-model="novo.numeroCarteira" maxlength="30"
        /></label>
        <label>{{ t('vinculos.cobertura.validade') }} <input v-model="novo.validade" type="date" /></label>
        <label
          ><input v-model="novo.titular" type="checkbox" />
          {{ t('vinculos.cobertura.pacienteTitular') }}</label
        >
        <template v-if="!novo.titular">
          <label
            >{{ t('vinculos.cobertura.titular') }} <input v-model="novo.titularNome" maxlength="150"
          /></label>
          <SanteSelecao
            v-model="novo.parentesco"
            :rotulo="t('vinculos.cobertura.parentesco')"
            :opcoes="[
              { valor: 0, rotulo: t('vinculos.comum.escolha'), desabilitada: true },
              ...opcoes.parentescos.map((p) => ({ valor: p.id, rotulo: p.descricao })),
            ]"
          />
        </template>
        <ul v-if="pendencias.length && novo.fontePagadora" class="pendencias">
          <li v-for="p in pendencias" :key="p">{{ p }}</li>
        </ul>
        <button type="submit" :disabled="pendencias.length > 0">{{ t('vinculos.cobertura.incluir') }}</button>
      </form>
    </template>
  </section>
</template>
