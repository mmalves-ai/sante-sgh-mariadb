<script setup lang="ts">
// W0-07 (programa CRUD completo, mercado M1): os escores de deterioração e de sepse de um atendimento do PA, num
// diálogo com duas abas. "Registrar aferição": os sinais (pré-preenchidos com os mais recentes do atendimento, como os
// da classificação), e o servidor calcula NEWS2, qSOFA e SIRS e diz se o limiar de sepse foi atingido. "Histórico": todos
// os escores, os estornados também (marcados, com o motivo); o válido pode ser estornado com o motivo e, na mesma
// operação, relançado com os sinais certos. Nada se apaga. A recusa do servidor aparece num aviso único.
import { CODIGOS_ACVPU, type EscorePaLidoContrato, type SinaisEscorePa } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { estornarEscorePa, lerEscoresPa, novaChave, registrarEscorePa } from '../api-atendimento.js';
import ErroAtendimento from './ErroAtendimento.vue';
import { pode } from '../../../casca/sessao/pode.js';

const props = defineProps<{ reg: number; paciente: string; podeRegistrar: boolean }>();
const visivel = defineModel<boolean>('visivel', { required: true });
const { t } = useI18n();
const cliente = useQueryClient();

const dados = useQuery({
  queryKey: computed(() => ['atendimento', 'escores-pa', props.reg]),
  queryFn: () => lerEscoresPa(props.reg),
  enabled: visivel,
});

type Campo = 'fr' | 'spo2' | 'o2' | 'pas' | 'fc' | 'temperatura' | 'leucocitos';
const CAMPOS: readonly Campo[] = ['fr', 'spo2', 'o2', 'pas', 'fc', 'temperatura', 'leucocitos'];
type Formulario = Record<Campo, string> & { consciencia: string; bastoes10: boolean };
const vazio = (): Formulario => ({
  fr: '',
  spo2: '',
  o2: '0',
  pas: '',
  fc: '',
  temperatura: '',
  leucocitos: '',
  consciencia: '',
  bastoes10: false,
});
const novo = reactive<Formulario>(vazio());
const correto = reactive<Formulario>(vazio());
const origem = ref<'classificacao' | 'reavaliacao'>('reavaliacao');
const aba = ref<'registrar' | 'historico'>('registrar');
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const enviando = ref(false);

function preencher(f: Formulario, s: SinaisEscorePa | null): void {
  Object.assign(f, vazio());
  if (!s) return;
  for (const c of CAMPOS) if (s[c] !== null && s[c] !== undefined) f[c] = String(s[c]).replace('.', ',');
  if (s.consciencia) f.consciencia = s.consciencia;
  f.bastoes10 = s.bastoes10 === true;
}
watch(
  () => [visivel.value, dados.data.value] as const,
  ([v, d]) => {
    if (!v || !d) return;
    if (!novo.fr && !novo.pas) {
      preencher(novo, d.sinaisRecentes);
      origem.value = d.sinaisRecentes ? 'classificacao' : 'reavaliacao';
    }
  },
);
watch(visivel, (v) => {
  if (v) {
    Object.assign(novo, vazio());
    erro.value = null;
    mensagem.value = null;
    aba.value = 'registrar';
  }
});

const numero = (x: string): number | null => {
  const v = x.trim().replace(',', '.');
  if (v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const sinaisDe = (f: Formulario): SinaisEscorePa => ({
  fr: numero(f.fr),
  spo2: numero(f.spo2),
  o2: numero(f.o2),
  pas: numero(f.pas),
  fc: numero(f.fc),
  consciencia: (f.consciencia || null) as SinaisEscorePa['consciencia'],
  temperatura: numero(f.temperatura),
  leucocitos: numero(f.leucocitos),
  bastoes10: f.bastoes10 ? true : null,
});
/** A aferição completa do NEWS2 (o leucograma é opcional). */
const completo = (f: Formulario) =>
  (['fr', 'spo2', 'o2', 'pas', 'fc', 'temperatura'] as const).every((c) => numero(f[c]) !== null) &&
  f.consciencia !== '';

const opcoesConsciencia = computed(() => [
  { valor: '', rotulo: t('escorePa.escolhaConsciencia') },
  ...CODIGOS_ACVPU.map((c) => ({ valor: c as string, rotulo: t(`escorePa.consciencias.${c}`) })),
]);
const opcoesOrigem = computed(() =>
  (['reavaliacao', 'classificacao'] as const).map((o) => ({ valor: o, rotulo: t(`escorePa.origens.${o}`) })),
);

async function invalidar(): Promise<void> {
  await Promise.all([
    cliente.invalidateQueries({ queryKey: ['atendimento', 'escores-pa', props.reg] }),
    cliente.invalidateQueries({ queryKey: ['atendimento', 'quadro'] }),
  ]);
}

async function registrar(): Promise<void> {
  if (!completo(novo) || enviando.value) return;
  erro.value = null;
  mensagem.value = null;
  enviando.value = true;
  try {
    const r = await registrarEscorePa(
      props.reg,
      { origem: origem.value, sinais: sinaisDe(novo) },
      novaChave('escore-pa'),
    );
    mensagem.value = r.mensagem;
    await invalidar();
    aba.value = 'historico';
  } catch (x) {
    erro.value = x;
  } finally {
    enviando.value = false;
  }
}

// ── Estorno ──
const estornando = ref<EscorePaLidoContrato | null>(null);
const motivo = ref('');
const relancar = ref(false);
const erroEstorno = ref<unknown>(null);
const visivelEstorno = computed({
  get: () => estornando.value !== null,
  set: (v: boolean) => {
    if (!v) estornando.value = null;
  },
});
function abrirEstorno(x: EscorePaLidoContrato): void {
  estornando.value = x;
  motivo.value = '';
  relancar.value = false;
  erroEstorno.value = null;
  preencher(correto, x.sinais);
}
const prontoEstorno = computed(
  () => motivo.value.trim().length >= 5 && (!relancar.value || completo(correto)) && !enviando.value,
);
async function estornar(): Promise<void> {
  const x = estornando.value;
  if (!x || !prontoEstorno.value) return;
  erroEstorno.value = null;
  enviando.value = true;
  try {
    const r = await estornarEscorePa(
      props.reg,
      { escore: x.id, motivo: motivo.value.trim(), relancar: relancar.value ? sinaisDe(correto) : null },
      novaChave('estornar-escore-pa'),
    );
    mensagem.value = r.mensagem;
    estornando.value = null;
    await invalidar();
  } catch (e) {
    erroEstorno.value = e;
  } finally {
    enviando.value = false;
  }
}

const escores = (x: { news2: { total: number }; qsofa: { total: number }; sirs: { total: number } }) =>
  t('escorePa.chip', { news2: x.news2.total, qsofa: x.qsofa.total, sirs: x.sirs.total });
const verProtocolos = computed(() => pode('recepcao.protocoloPaciente.ler'));
const quando = (s: string) => s.replace('T', ' ').slice(0, 16);
const motivoSepse = computed(() =>
  (dados.data.value?.alerta?.motivoSepse ?? []).map((m) => (m === 'news2' ? 'NEWS2' : 'qSOFA')).join(', '),
);
</script>

<template>
  <SanteDialogo v-model:visivel="visivel" :titulo="t('escorePa.titulo')" largura="46rem">
    <div class="escores-pa" :data-testid="`escores-pa-${reg}`">
      <p>
        <strong>{{ paciente }}</strong>
      </p>
      <p v-if="dados.data.value" class="secundario">
        {{
          t('escorePa.texto', {
            news2: dados.data.value.limiares.news2,
            qsofa: dados.data.value.limiares.qsofa,
          })
        }}
      </p>
      <ErroAtendimento v-if="dados.isError.value" :erro="dados.error.value" />
      <template v-if="dados.data.value">
        <div v-if="dados.data.value.alerta" class="cartao-alerta" data-testid="escores-pa-alerta">
          <SanteAlerta
            :variante="dados.data.value.alerta.sugereSepse ? 'alerta' : 'info'"
            :icone="dados.data.value.alerta.sugereSepse ? 'alerta' : 'relogio'"
            :texto="`${escores(dados.data.value.alerta)} · ${t(`escorePa.niveis.${dados.data.value.alerta.nivel}`)}`"
          />
          <p v-if="dados.data.value.alerta.sugereSepse" data-testid="escores-pa-sepse">
            {{ t('escorePa.sepseSugerida', { motivo: motivoSepse }) }}
            <RouterLink
              v-if="verProtocolos"
              :to="`/pa/protocolos?reg=${reg}&tipo=sepse`"
              data-testid="escores-pa-abrir-protocolo"
              >{{ t('escorePa.abrirProtocolo') }}</RouterLink
            >
          </p>
        </div>
        <div class="abas" role="tablist" :aria-label="t('escorePa.titulo')">
          <button
            v-for="a in ['registrar', 'historico'] as const"
            :id="`aba-escore-${a}`"
            :key="a"
            type="button"
            role="tab"
            :aria-selected="aba === a"
            :aria-controls="`painel-escore-${a}`"
            :tabindex="aba === a ? 0 : -1"
            :data-testid="`aba-escore-${a}`"
            @click="aba = a"
          >
            {{ t(`escorePa.abas.${a}`) }}
          </button>
        </div>
        <form
          v-if="aba === 'registrar'"
          id="painel-escore-registrar"
          role="tabpanel"
          aria-labelledby="aba-escore-registrar"
          class="formulario"
          data-testid="escores-pa-form"
          @submit.prevent="registrar"
        >
          <p v-if="dados.data.value.sinaisRecentes" class="secundario">{{ t('escorePa.sinaisRecentes') }}</p>
          <SanteSelecao
            v-model="origem"
            :rotulo="t('escorePa.origem')"
            :opcoes="opcoesOrigem"
            data-testid="escores-pa-origem"
          />
          <div class="grade">
            <label v-for="c in CAMPOS" :key="c" class="campo">
              <span>{{ t(`escorePa.campos.${c}`) }}</span>
              <input
                v-model="novo[c]"
                inputmode="decimal"
                :required="c !== 'leucocitos'"
                :data-testid="`escores-pa-${c}`"
              />
            </label>
          </div>
          <SanteSelecao
            v-model="novo.consciencia"
            :rotulo="t('escorePa.campos.consciencia')"
            :opcoes="opcoesConsciencia"
            obrigatorio
            data-testid="escores-pa-consciencia"
          />
          <label class="caixa">
            <input v-model="novo.bastoes10" type="checkbox" data-testid="escores-pa-bastoes" />
            {{ t('escorePa.campos.bastoes10') }}
          </label>
          <div class="acoes">
            <SanteBotao
              :rotulo="t('escorePa.registrar')"
              variante="primario"
              :desabilitado="!podeRegistrar || !completo(novo) || enviando"
              data-testid="escores-pa-registrar"
              @acionar="registrar"
            />
          </div>
        </form>
        <div
          v-else
          id="painel-escore-historico"
          role="tabpanel"
          aria-labelledby="aba-escore-historico"
          data-testid="escores-pa-historico"
        >
          <p v-if="dados.data.value.historico.length === 0" class="secundario">
            {{ t('escorePa.semHistorico') }}
          </p>
          <table v-else class="tabela">
            <thead>
              <tr>
                <th scope="col">{{ t('escorePa.colunas.quando') }}</th>
                <th scope="col">{{ t('escorePa.colunas.origem') }}</th>
                <th scope="col">{{ t('escorePa.colunas.escores') }}</th>
                <th scope="col">{{ t('escorePa.colunas.nivel') }}</th>
                <th scope="col">{{ t('escorePa.colunas.por') }}</th>
                <th scope="col">{{ t('escorePa.colunas.situacao') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="x in dados.data.value.historico"
                :key="x.id"
                :class="{ estornado: x.estorno }"
                :data-testid="`escore-pa-linha-${x.id}`"
              >
                <td>{{ quando(x.aferidoEm) }}</td>
                <td>
                  {{ t(`escorePa.origens.${x.origem}`) }}
                  <small v-if="x.substitui" class="secundario">
                    · {{ t('escorePa.substitui', { id: x.substitui }) }}</small
                  >
                </td>
                <td>{{ escores(x) }}</td>
                <td>{{ t(`escorePa.niveis.${x.nivel}`) }}</td>
                <td>{{ x.usuario }}</td>
                <td>
                  <template v-if="x.estorno">
                    {{
                      t('escorePa.estornado', {
                        em: quando(x.estorno.em),
                        por: x.estorno.usuario,
                        motivo: x.estorno.motivo,
                      })
                    }}
                  </template>
                  <template v-else>
                    {{ t('escorePa.valido') }}
                    <SanteBotao
                      v-if="podeRegistrar"
                      variante="secundario"
                      :rotulo="t('escorePa.estornar')"
                      :data-testid="`escore-pa-estornar-${x.id}`"
                      @acionar="abrirEstorno(x)"
                    />
                  </template>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
      <p v-if="mensagem" role="status" data-testid="escores-pa-mensagem">{{ mensagem }}</p>
      <ErroAtendimento v-if="erro" :erro="erro" />
      <div class="acoes">
        <SanteBotao :rotulo="t('escorePa.fechar')" variante="secundario" @acionar="visivel = false" />
      </div>
    </div>
  </SanteDialogo>

  <SanteDialogo v-model:visivel="visivelEstorno" :titulo="t('escorePa.estornarTitulo')" largura="40rem">
    <form v-if="estornando" class="formulario" data-testid="escore-pa-estorno" @submit.prevent="estornar">
      <p>{{ t('escorePa.estornarTexto') }}</p>
      <p>
        <strong>{{ escores(estornando) }}</strong> · {{ quando(estornando.aferidoEm) }}
      </p>
      <SanteCampoTexto
        v-model="motivo"
        :rotulo="t('escorePa.motivo')"
        :max-bytes="300"
        multilinha
        obrigatorio
        data-testid="escore-pa-estorno-motivo"
      />
      <p v-if="motivo.trim().length > 0 && motivo.trim().length < 5" class="secundario" role="status">
        {{ t('escorePa.motivoCurto') }}
      </p>
      <label class="caixa">
        <input v-model="relancar" type="checkbox" data-testid="escore-pa-estorno-relancar" />
        {{ t('escorePa.relancar') }}
      </label>
      <template v-if="relancar">
        <div class="grade">
          <label v-for="c in CAMPOS" :key="c" class="campo">
            <span>{{ t(`escorePa.campos.${c}`) }}</span>
            <input v-model="correto[c]" inputmode="decimal" :data-testid="`escore-pa-estorno-${c}`" />
          </label>
        </div>
        <SanteSelecao
          v-model="correto.consciencia"
          :rotulo="t('escorePa.campos.consciencia')"
          :opcoes="opcoesConsciencia"
          obrigatorio
          data-testid="escore-pa-estorno-consciencia"
        />
      </template>
      <div v-if="erroEstorno" role="alert" data-testid="escore-pa-estorno-recusa">
        <ErroAtendimento :erro="erroEstorno" />
      </div>
      <div class="acoes">
        <SanteBotao
          :rotulo="relancar ? t('escorePa.estornarRelancarConfirmar') : t('escorePa.estornarConfirmar')"
          variante="primario"
          :desabilitado="!prontoEstorno"
          data-testid="escore-pa-estorno-confirmar"
          @acionar="estornar"
        />
        <SanteBotao :rotulo="t('escorePa.voltar')" variante="secundario" @acionar="estornando = null" />
      </div>
    </form>
  </SanteDialogo>
</template>

<style scoped>
.escores-pa,
.formulario {
  display: grid;
  gap: var(--sgh-espaco-2);
}
.escores-pa p {
  margin: 0;
}
.cartao-alerta {
  display: grid;
  gap: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  border-radius: 6px;
  padding: var(--sgh-espaco-2);
}
.abas {
  display: flex;
  gap: var(--sgh-espaco-1);
  border-bottom: 1px solid var(--sgh-borda);
}
.abas button {
  background: none;
  border: 1px solid transparent;
  border-radius: 6px 6px 0 0;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  cursor: pointer;
  color: inherit;
}
.abas button[aria-selected='true'] {
  font-weight: 700;
  border-color: var(--sgh-borda-forte);
}
.grade {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
  gap: var(--sgh-espaco-2);
}
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
.caixa {
  display: flex;
  gap: var(--sgh-espaco-1);
  align-items: center;
}
.tabela {
  width: 100%;
  border-collapse: collapse;
}
.tabela th,
.tabela td {
  text-align: left;
  padding: var(--sgh-espaco-1);
  border-bottom: 1px solid var(--sgh-borda);
  vertical-align: top;
}
.estornado td {
  text-decoration: line-through;
  text-decoration-thickness: 1px;
}
.estornado td:last-child {
  text-decoration: none;
}
.acoes {
  display: flex;
  gap: var(--sgh-espaco-2);
  flex-wrap: wrap;
}
</style>
