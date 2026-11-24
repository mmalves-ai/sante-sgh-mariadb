<script setup lang="ts">
// Guias e autorizações do convênio (ficha do M21, seção 7): `/internacao/:reg/guias`. As guias de cada conta com o
// alerta de vencimento (vence até amanhã ou vencida com a internação aberta). A guia da conta principal nasce com a
// admissão; a prorrogação vai na conta parcial que o faturamento abre (a guia começa no início da conta).
// F3.4 (04-INT 68): o histórico das autorizações (inicial e prorrogações, cada uma com o seu período e quem autorizou),
// a prévia do período na hora e a correção de uma guia com motivo, que não cria linha nova nem soma diárias.
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { dataBr } from '../../agenda/formato.js';
import { novaChave, registrarGuia } from '../api-adt.js';
import { corrigirGuia, lerRegistros, previaDaGuia, type RegistrosInternacao } from '../api-registros.js';
import AvisoAdt from '../componentes/AvisoAdt.vue';
import ErroAdt from '../componentes/ErroAdt.vue';
import ResumoInternacao from '../componentes/ResumoInternacao.vue';
import { usarAdt } from '../usar-adt.js';
import { usarInternacao } from '../usar-internacao.js';

const props = defineProps<{ reg: string }>();
const { t } = useI18n();
const { pode, motivoDe } = usarAdt();
const podeGuia = pode('internacao.registrarGuia');
const aviso = motivoDe('internacao.registrarGuia');
const reg = computed(() => Number(props.reg));
const { ficha, recarregar } = usarInternacao(reg);
const parciais = computed(() =>
  (ficha.data.value?.contas ?? []).filter((c) => c.conta !== reg.value && c.tipo === 'P'),
);
const opcoesConta = computed(() => [
  { valor: '', rotulo: t('adt.escolha') },
  ...parciais.value.map((c) => ({ valor: String(c.conta), rotulo: `${c.conta} (${dataBr(c.inicio)})` })),
]);
const alertas = computed(() => (ficha.data.value?.guias ?? []).filter((g) => g.vencimento !== 'vigente'));
const conta = ref('');
const guia = ref('');
const senha = ref('');
const validade = ref('1');
const inicio = ref('');
const autorizador = ref('');
const registros = ref<RegistrosInternacao | null>(null);
async function lerHistorico(): Promise<void> {
  try {
    registros.value = await lerRegistros(reg.value);
  } catch (x) {
    erro.value = x;
  }
}
onMounted(lerHistorico);
const previa = computed(() => {
  const f = ficha.data.value;
  if (!f || !registros.value) return null;
  return previaDaGuia(registros.value.guias, f.entrada, Number(validade.value), inicio.value || undefined);
});
// Correção de uma guia já registrada (número, senha, autorizador; o período só na última).
const corrigindo = ref<number | null>(null);
const corr = ref({ guia: '', senha: '', autorizador: '', validade: '', motivo: '' });
const ultima = computed(() => registros.value?.guias.at(-1)?.sequencia ?? null);
function abrirCorrecao(seq: number): void {
  const g = registros.value?.guias.find((x) => x.sequencia === seq);
  if (!g) return;
  corrigindo.value = seq;
  corr.value = {
    guia: g.guia,
    senha: g.senha ?? '',
    autorizador: g.autorizador ?? '',
    validade: String(g.diarias),
    motivo: '',
  };
}
async function gravarCorrecao(): Promise<void> {
  if (corrigindo.value === null) return;
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const c = corr.value;
    const r = await corrigirGuia(
      reg.value,
      corrigindo.value,
      {
        guia: c.guia.trim(),
        motivo: c.motivo.trim(),
        ...(c.senha.trim() ? { senha: c.senha.trim() } : {}),
        ...(c.autorizador.trim() ? { autorizador: c.autorizador.trim() } : {}),
        ...(corrigindo.value === ultima.value ? { validadeDias: Number(c.validade) } : {}),
      },
      novaChave('guia-correcao'),
    );
    mensagem.value = r.mensagem;
    corrigindo.value = null;
    await Promise.all([recarregar(), lerHistorico()]);
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);
async function gravar(): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = await registrarGuia(
      reg.value,
      {
        conta: Number(conta.value),
        guia: guia.value.trim(),
        validadeDias: Number(validade.value),
        ...(senha.value.trim() ? { senha: senha.value.trim() } : {}),
        ...(inicio.value ? { inicio: inicio.value } : {}),
        ...(autorizador.value.trim() ? { autorizador: autorizador.value.trim() } : {}),
      },
      novaChave('guia'),
    );
    mensagem.value = r.mensagem;
    guia.value = '';
    senha.value = '';
    inicio.value = '';
    autorizador.value = '';
    await Promise.all([recarregar(), lerHistorico()]);
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="guias-titulo" data-testid="tela-guias">
    <h1 id="guias-titulo">{{ t('adt.guias.titulo') }}</h1>
    <p>{{ t('adt.guias.texto') }}</p>
    <AvisoAdt :motivo="aviso" />
    <ErroAdt v-if="ficha.isError.value" :erro="ficha.error.value" />
    <p v-else-if="!ficha.data.value" role="status">{{ t('adt.carregando') }}</p>
    <template v-else>
      <ResumoInternacao :internacao="ficha.data.value" atalhos />
      <SanteAlerta
        v-for="g in alertas"
        :key="`${g.conta}-${g.guia}`"
        variante="aviso"
        :texto="`${t('adt.guias.guia')} ${g.guia}: ${t(`adt.guias.vencimento.${g.vencimento}`)}`"
      />
      <table class="tabela" data-testid="tabela-guias">
        <caption class="secundario">
          {{
            t('adt.guias.titulo')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('adt.guias.conta') }}</th>
            <th scope="col">{{ t('adt.guias.guia') }}</th>
            <th scope="col">{{ t('adt.guias.inicio') }}</th>
            <th scope="col">{{ t('adt.guias.fim') }}</th>
            <th scope="col">{{ t('adt.guias.validade') }}</th>
            <th scope="col">{{ t('adt.guias.senha') }}</th>
            <th scope="col">{{ t('adt.guias.vencimento.vigente') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="g in ficha.data.value.guias"
            :key="`${g.conta}-${g.guia}`"
            :data-testid="`guia-${g.guia}`"
          >
            <td>{{ g.conta }}</td>
            <td>{{ g.guia }}</td>
            <td>{{ dataBr(g.inicio) }}</td>
            <td>{{ dataBr(g.fim) }}</td>
            <td>{{ g.validadeDias }}</td>
            <td>{{ g.temSenha ? t('adt.guias.comSenha') : t('adt.guias.semSenha') }}</td>
            <td>{{ t(`adt.guias.vencimento.${g.vencimento}`) }}</td>
          </tr>
        </tbody>
      </table>
      <section v-if="registros" class="painel" aria-labelledby="guias-historico">
        <h2 id="guias-historico">{{ t('adt.guias.historico') }}</h2>
        <p data-testid="guias-total">
          {{ t('adt.guias.totalAutorizado', { n: registros.diariasAutorizadas }) }}
        </p>
        <table class="tabela" data-testid="tabela-historico-guias">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">{{ t('adt.guias.guia') }}</th>
              <th scope="col">{{ t('adt.guias.inicio') }}</th>
              <th scope="col">{{ t('adt.guias.fim') }}</th>
              <th scope="col">{{ t('adt.guias.validade') }}</th>
              <th scope="col">{{ t('adt.guias.autorizador') }}</th>
              <th scope="col"></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="g in registros.guias"
              :key="g.sequencia"
              :data-testid="`historico-guia-${g.sequencia}`"
            >
              <td>{{ g.sequencia }} {{ t(`adt.guias.tipo.${g.tipo}`) }}</td>
              <td>
                {{ g.guia }}
                <small v-if="g.motivoCorrecao" class="secundario">
                  {{ t('adt.guias.corrigida', { motivo: g.motivoCorrecao }) }}
                </small>
              </td>
              <td>{{ dataBr(g.inicio) }}</td>
              <td>{{ dataBr(g.fim) }}</td>
              <td>{{ g.diarias }}</td>
              <td>{{ g.autorizador ?? '' }}</td>
              <td>
                <SanteBotao
                  v-if="podeGuia"
                  :rotulo="t('adt.guias.corrigir')"
                  variante="secundario"
                  :data-testid="`guia-corrigir-${g.sequencia}`"
                  @acionar="abrirCorrecao(g.sequencia)"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="corrigindo !== null" class="filtros" data-testid="guia-correcao">
          <h3>{{ t('adt.guias.corrigindo', { seq: corrigindo }) }}</h3>
          <SanteCampoTexto v-model="corr.guia" :rotulo="t('adt.guias.guia')" :max-bytes="20" obrigatorio />
          <SanteCampoTexto v-model="corr.senha" :rotulo="t('adt.guias.senha')" :max-bytes="20" />
          <SanteCampoTexto v-model="corr.autorizador" :rotulo="t('adt.guias.autorizador')" :max-bytes="150" />
          <div v-if="corrigindo === ultima" class="campo">
            <label for="guia-correcao-validade">{{ t('adt.guias.validade') }}</label>
            <input id="guia-correcao-validade" v-model="corr.validade" type="number" min="1" max="999" />
          </div>
          <SanteCampoTexto
            v-model="corr.motivo"
            :rotulo="t('adt.guias.motivo')"
            :max-bytes="400"
            obrigatorio
            data-testid="guia-correcao-motivo"
          />
          <SanteBotao
            :rotulo="t('adt.guias.gravarCorrecao')"
            :desabilitado="!corr.guia.trim() || corr.motivo.trim().length < 5 || ocupado"
            data-testid="guia-correcao-gravar"
            @acionar="gravarCorrecao"
          />
          <SanteBotao :rotulo="t('adt.guias.cancelar')" variante="secundario" @acionar="corrigindo = null" />
        </div>
      </section>
      <section v-if="podeGuia" class="painel" aria-labelledby="guias-nova">
        <h2 id="guias-nova">{{ t('adt.guias.registrar') }}</h2>
        <p v-if="parciais.length === 0" class="secundario" data-testid="guias-sem-parcial">
          {{ t('adt.guias.semContaParcial') }}
        </p>
        <div class="filtros">
          <SanteSelecao
            v-model="conta"
            :rotulo="t('adt.guias.conta')"
            :opcoes="opcoesConta"
            data-testid="guia-conta"
          />
          <SanteCampoTexto
            v-model="guia"
            :rotulo="t('adt.guias.guia')"
            :max-bytes="20"
            obrigatorio
            data-testid="guia-numero"
          />
          <SanteCampoTexto v-model="senha" :rotulo="t('adt.guias.senha')" :max-bytes="20" />
          <div class="campo">
            <label for="guia-validade">{{ t('adt.guias.validade') }}</label>
            <input id="guia-validade" v-model="validade" type="number" min="1" max="999" />
          </div>
          <div class="campo">
            <label for="guia-inicio">{{ t('adt.guias.inicioOpcional') }}</label>
            <input id="guia-inicio" v-model="inicio" type="date" data-testid="guia-inicio" />
          </div>
          <SanteCampoTexto
            v-model="autorizador"
            :rotulo="t('adt.guias.autorizador')"
            :max-bytes="150"
            data-testid="guia-autorizador"
          />
        </div>
        <p v-if="previa" class="secundario" data-testid="guia-previa">
          {{ t('adt.guias.previa', { inicio: dataBr(previa.inicio), fim: dataBr(previa.fim) }) }}
        </p>
        <SanteBotao
          :rotulo="t('adt.guias.registrar')"
          :desabilitado="!conta || !guia.trim() || Number(validade) < 1 || ocupado"
          data-testid="guia-gravar"
          @acionar="gravar"
        />
        <p v-if="mensagem" role="status" data-testid="guia-gravada">{{ mensagem }}</p>
        <ErroAdt v-if="erro" :erro="erro" />
      </section>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
