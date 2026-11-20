<script setup lang="ts">
// Classificação de pacientes (ficha do M45, seção 7; regra 9): Fugulin nas unidades de internação e NAS na terapia
// intensiva, uma vez por turno, e a carga de trabalho da unidade em horas de enfermagem com as parcelas impressas,
// comparada com a equipe informada na tela (até a escala da Fase 6). A prévia usa o mesmo motor do servidor
// (@sgh/dominio-enfermagem); só o enfermeiro classifica (o servidor confere pelo vínculo).
import { AREAS_FUGULIN, type InstrumentoClassificacao, ITENS_NAS, type Turno } from '@sgh/contratos';
import { classificar, compararComEquipe } from '@sgh/dominio-enfermagem';
import { SanteBotao, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { classificarPaciente, estornarClassificacao, lerCarga } from '../api-escores.js';
import DialogoCorrecao, { type DadosCorrecao } from '../componentes/DialogoCorrecao.vue';
import ErroEnfermagem from '../componentes/ErroEnfermagem.vue';
import SeletorUnidade from '../componentes/SeletorUnidade.vue';
import { usarEnfermagem } from '../usar-enfermagem.js';

const { t } = useI18n();
const { unidade, escolherUnidade, opcoesUnidade } = usarEnfermagem();
const data = ref('');
const turno = ref<Turno | ''>('');
const carga = useQuery({
  queryKey: computed(() => ['classificacao', unidade.value, data.value, turno.value]),
  queryFn: () => lerCarga(unidade.value, data.value || undefined, turno.value || undefined),
  enabled: computed(() => !!unidade.value),
});
watch(
  () => carga.data.value,
  (c) => {
    if (c && !data.value) {
      data.value = c.data;
      turno.value = c.turno;
    }
  },
);
const opcoesTurno = computed(() => [
  { valor: 'diurno' as Turno, rotulo: t('enfermagem.classif.diurno') },
  { valor: 'noturno' as Turno, rotulo: t('enfermagem.classif.noturno') },
]);

// A equipe informada (até a escala da Fase 6): profissionais × horas do turno contra as horas necessárias.
const profissionais = ref(2);
const horasTurno = ref(12);
const horasNecessarias24h = computed(() => {
  const c = carga.data.value?.carga;
  if (!c) return 0;
  return Math.round((c.fugulin.horas24h + (c.nas.soma * 24) / 100) * 10) / 10;
});
const comparacao = computed(() =>
  compararComEquipe({
    horasNecessarias24h: horasNecessarias24h.value,
    profissionais: Number(profissionais.value) || 0,
    horasDoTurno: Number(horasTurno.value) || 12,
  }),
);
const fmt = (n: number) => String(n).replace('.', ',');

// O diálogo de classificação.
const aberto = ref(false);
const alvo = ref<{ paciente: number; atendimento: number; reg: number; nome: string; leito: string } | null>(
  null,
);
const instrumento = ref<InstrumentoClassificacao>('fugulin');
const fugulin = reactive<Record<string, number | null>>({});
const nas = reactive<Record<string, string>>({});
const opcoesInstrumento = computed(() => [
  { valor: 'fugulin' as InstrumentoClassificacao, rotulo: t('enfermagem.classif.fugulin') },
  { valor: 'nas' as InstrumentoClassificacao, rotulo: t('enfermagem.classif.nas') },
]);
function abrir(p: { paciente: number; atendimento: number; reg: number; nome: string; leito: string }): void {
  alvo.value = p;
  instrumento.value = unidade.value.toUpperCase().includes('UTI') ? 'nas' : 'fugulin';
  for (const k of Object.keys(fugulin)) delete fugulin[k];
  for (const k of Object.keys(nas)) delete nas[k];
  erro.value = null;
  aberto.value = true;
}
const respostas = computed<Record<string, number | string>>(() => {
  if (instrumento.value === 'fugulin') {
    const r: Record<string, number> = {};
    for (const a of AREAS_FUGULIN) if (fugulin[a.codigo]) r[a.codigo] = fugulin[a.codigo]!;
    return r;
  }
  const r: Record<string, string> = {};
  for (const [k, v] of Object.entries(nas)) if (v) r[k] = v;
  return r;
});
const previa = computed(() => classificar(instrumento.value, respostas.value));
const opcoesNas = (i: (typeof ITENS_NAS)[number]) =>
  i.subitens
    ? [
        { valor: '', rotulo: t('enfermagem.classif.nenhum') },
        ...i.subitens.map((s) => ({ valor: s.codigo, rotulo: `${s.rotulo} (${fmt(s.peso)})` })),
      ]
    : [
        { valor: '', rotulo: t('enfermagem.classif.nenhum') },
        { valor: 'sim', rotulo: `${t('enfermagem.comum.confirmar')} (${fmt(i.peso ?? 0)})` },
      ];

const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);
async function salvar(): Promise<void> {
  const p = alvo.value;
  if (!p || !carga.data.value) return;
  erro.value = null;
  ocupado.value = true;
  try {
    const r = await classificarPaciente({
      paciente: p.paciente,
      atendimento: p.atendimento,
      reg: p.reg,
      unidade: unidade.value,
      data: carga.data.value.data,
      turno: carga.data.value.turno,
      instrumento: instrumento.value,
      itens: respostas.value,
    });
    mensagem.value = r.mensagem;
    aberto.value = false;
    await carga.refetch();
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
// W0-03: estornar ou invalidar a classificação (inativa e visível; sai da carga; relança-se no mesmo turno).
const estornando = ref<number | null>(null);
const dialogoEstorno = ref(false);
function abrirEstorno(id: number): void {
  estornando.value = id;
  dialogoEstorno.value = true;
}
async function estornar(d: DadosCorrecao): Promise<void> {
  const id = estornando.value;
  if (id === null) return;
  const r = await estornarClassificacao(id, { tipo: d.tipo, motivo: d.motivo });
  mensagem.value = r.mensagem;
  await carga.refetch();
}
const hora = (iso: string | null | undefined) => (iso ? iso.slice(0, 16).replace('T', ' ') : '—');
</script>

<template>
  <section class="tela-enf" aria-labelledby="cl-titulo" data-testid="tela-classificacao">
    <h1 id="cl-titulo">{{ t('enfermagem.classif.titulo') }}</h1>
    <p>{{ t('enfermagem.classif.texto') }}</p>
    <div class="barra">
      <SeletorUnidade :model-value="unidade" :opcoes="opcoesUnidade" @update:model-value="escolherUnidade" />
      <span class="campo">
        <label for="cl-data">{{ t('enfermagem.classif.data') }}</label>
        <input id="cl-data" v-model="data" type="date" data-testid="cl-data" />
      </span>
      <SanteSelecao
        v-model="turno"
        :rotulo="t('enfermagem.classif.turno')"
        :opcoes="opcoesTurno"
        data-testid="cl-turno"
      />
    </div>
    <p v-if="mensagem" role="status" data-testid="cl-mensagem">{{ mensagem }}</p>
    <ErroEnfermagem v-if="carga.isError.value" :erro="carga.error.value" />
    <p v-else-if="!carga.data.value" role="status">{{ t('enfermagem.comum.carregando') }}</p>
    <template v-else>
      <p v-if="!carga.data.value.gravacao.ligada" class="alerta" data-testid="cl-consulta">
        {{ t('enfermagem.classif.consulta', { motivo: carga.data.value.gravacao.motivo ?? '' }) }}
      </p>
      <section class="cartao" aria-labelledby="cl-carga" data-testid="cl-carga">
        <h2 id="cl-carga">{{ t('enfermagem.classif.carga') }}</h2>
        <ul>
          <li v-for="c in carga.data.value.carga.fugulin.porCategoria" :key="c.codigo">
            {{
              t('enfermagem.classif.porCategoria', {
                rotulo: c.rotulo,
                pacientes: c.pacientes,
                horas: c.pacientes ? c.horas / c.pacientes : 0,
              })
            }}
            {{ t('enfermagem.classif.igualHoras', { h: fmt(c.horas) }) }}
          </li>
          <li>
            <strong>{{
              t('enfermagem.classif.fugulinTotal', { horas: fmt(carga.data.value.carga.fugulin.horas24h) })
            }}</strong>
          </li>
          <li>
            <strong>{{
              t('enfermagem.classif.nasTotal', {
                soma: fmt(carga.data.value.carga.nas.soma),
                profissionais: fmt(carga.data.value.carga.nas.profissionaisPorTurno),
                pacientes: carga.data.value.carga.nas.pacientes,
              })
            }}</strong>
          </li>
          <li v-if="carga.data.value.carga.naoClassificados" class="alerta">
            {{ t('enfermagem.classif.naoClassificados', { n: carga.data.value.carga.naoClassificados }) }}
          </li>
        </ul>
        <fieldset class="equipe">
          <legend>{{ t('enfermagem.classif.equipe') }}</legend>
          <span class="campo">
            <label for="cl-prof">{{ t('enfermagem.classif.profissionais') }}</label>
            <input
              id="cl-prof"
              v-model.number="profissionais"
              type="number"
              min="0"
              max="200"
              data-testid="cl-profissionais"
            />
          </span>
          <span class="campo">
            <label for="cl-horas">{{ t('enfermagem.classif.horasTurno') }}</label>
            <input id="cl-horas" v-model.number="horasTurno" type="number" min="1" max="24" />
          </span>
        </fieldset>
        <p data-testid="cl-comparacao">{{ comparacao.conta }}.</p>
        <p :class="{ alerta: !comparacao.suficiente }">
          {{
            comparacao.suficiente
              ? t('enfermagem.classif.suficiente')
              : t('enfermagem.classif.insuficiente', { h: fmt(-comparacao.diferenca) })
          }}
        </p>
      </section>
      <div class="rolagem">
        <table class="grade" data-testid="cl-pacientes">
          <thead>
            <tr>
              <th scope="col">{{ t('enfermagem.escores.leito') }}</th>
              <th scope="col">{{ t('enfermagem.escores.paciente') }}</th>
              <th scope="col">{{ t('enfermagem.classif.classificado') }}</th>
              <th scope="col">{{ t('enfermagem.comum.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="p in carga.data.value.pacientes"
              :key="p.paciente"
              :data-testid="`cl-linha-${p.paciente}`"
            >
              <td>{{ p.leito }}</td>
              <td>{{ p.nome }}</td>
              <td>
                <span
                  v-for="c in p.classificacoes"
                  :key="c.id"
                  class="bloco"
                  :class="{ inativo: !!c.estorno }"
                  :data-testid="`cl-classif-${c.id}`"
                  :data-inativo="c.estorno ? 'sim' : 'nao'"
                >
                  <component :is="c.estorno ? 's' : 'span'">
                    {{ c.instrumento === 'nas' ? 'NAS' : 'Fugulin' }} {{ fmt(c.total) }} ·
                    {{ c.rotuloCategoria }} · {{ t('enfermagem.classif.horas', { h: fmt(c.horas24h) }) }}
                  </component>
                  <template v-if="c.estorno">
                    · <strong>{{ t('enfermagem.correcao.inativo') }}</strong> ·
                    {{
                      t('enfermagem.correcao.estornadoPor', {
                        tipo: t(`enfermagem.correcao.tipoCurto.${c.estorno.tipo}`),
                        por: c.estorno.usuario,
                        quando: hora(c.estorno.em),
                        motivo: c.estorno.motivo,
                      })
                    }}
                  </template>
                  <SanteBotao
                    v-else
                    variante="secundario"
                    :rotulo="t('enfermagem.correcao.classif.estornar')"
                    :desabilitado="!carga.data.value.gravacao.registrar"
                    :data-testid="`cl-estornar-${c.id}`"
                    @acionar="abrirEstorno(c.id)"
                  />
                </span>
              </td>
              <td>
                <SanteBotao
                  variante="secundario"
                  :rotulo="t('enfermagem.classif.classificar')"
                  :desabilitado="!carga.data.value.gravacao.registrar"
                  :data-testid="`cl-classificar-${p.paciente}`"
                  @acionar="abrir(p)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
    <DialogoCorrecao
      v-model:visivel="dialogoEstorno"
      :titulo="t('enfermagem.correcao.classif.titulo')"
      :texto="t('enfermagem.correcao.classif.texto')"
      com-tipo
      testid="cl-dialogo-estorno"
      :executar="estornar"
    />
    <SanteDialogo v-model:visivel="aberto" :titulo="t('enfermagem.classif.classificar')" largura="52rem">
      <div v-if="alvo" class="dialogo" data-testid="cl-dialogo">
        <p>{{ alvo.leito }} · {{ alvo.nome }}</p>
        <SanteSelecao
          v-model="instrumento"
          :rotulo="t('enfermagem.classif.instrumento')"
          :opcoes="opcoesInstrumento"
          data-testid="cl-instrumento"
        />
        <div v-if="instrumento === 'fugulin'" class="campos">
          <SanteSelecao
            v-for="a in AREAS_FUGULIN"
            :key="a.codigo"
            :model-value="fugulin[a.codigo] ?? null"
            :rotulo="a.rotulo"
            :opcoes="[
              { valor: null, rotulo: '—' },
              ...a.opcoes.map((o) => ({ valor: o.valor, rotulo: `${o.valor} · ${o.rotulo}` })),
            ]"
            :data-testid="`cl-fugulin-${a.codigo}`"
            @update:model-value="fugulin[a.codigo] = $event as number | null"
          />
        </div>
        <div v-else class="campos">
          <SanteSelecao
            v-for="i in ITENS_NAS"
            :key="i.codigo"
            :model-value="nas[i.codigo] ?? ''"
            :rotulo="i.rotulo"
            :opcoes="opcoesNas(i)"
            :data-testid="`cl-nas-${i.codigo}`"
            @update:model-value="nas[i.codigo] = String($event ?? '')"
          />
        </div>
        <p v-if="previa.ok" role="status" data-testid="cl-previa">
          {{ t('enfermagem.classif.total', { total: fmt(previa.total), categoria: previa.rotuloCategoria }) }}
          · {{ t('enfermagem.classif.horas', { h: fmt(previa.horas24h) }) }}
        </p>
        <p v-else class="secundario">{{ previa.mensagem }}</p>
        <ErroEnfermagem v-if="erro" :erro="erro" />
        <SanteBotao
          :rotulo="t('enfermagem.classif.salvar')"
          :desabilitado="!previa.ok || ocupado"
          data-testid="cl-salvar"
          @acionar="salvar"
        />
      </div>
    </SanteDialogo>
  </section>
</template>

<style src="./estilo-enfermagem.css"></style>
<style scoped>
.campos {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
  gap: var(--sgh-espaco-2);
}
.dialogo {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
}
.equipe {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda);
  padding: var(--sgh-espaco-2);
}
.bloco {
  display: block;
}
</style>
