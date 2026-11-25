<script setup lang="ts">
// Prescrição de lentes da oftalmologia (03-PEP linha 139): o histórico do paciente (vigentes, vencidas e canceladas,
// nada apagado), a emissão de óculos ou lente de contato pelo médico com a conferência na hora pelas mesmas regras do
// servidor (@sgh/dominio-pep), o ponto de partida na última prescrição, a transposição do cilindro, o equivalente
// esférico, a impressão e o cancelamento com motivo.
import {
  BASES_PRISMA,
  conferirPrescricaoLente,
  equivalenteEsferico,
  type GrauOlho,
  type PrescricaoLenteEntrada,
  TIPOS_LENTE,
  transporGrau,
  USOS_LENTE,
  type TipoLente,
  type UsoLente,
} from '@sgh/dominio-pep';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, nextTick, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { novaChaveEspecialidade } from '../api-especialidades.js';
import { cancelarLente, emitirLente, lerLentes, type PrescricaoLenteLida } from '../api-lentes.js';
import ErroEspecialidade from './ErroEspecialidade.vue';

const props = defineProps<{
  reg: number;
  pode: boolean;
  motivoPode: string | null;
  paciente: { nome: string; prontuario: number };
}>();
const { t } = useI18n();
const lista = useQuery({
  queryKey: computed(() => ['especialidades', 'oftalmologia', 'lentes', props.reg]),
  queryFn: () => lerLentes(props.reg),
});
const hoje = computed(() => lista.data.value?.hoje ?? new Date().toISOString().slice(0, 10));

type Lado = 'od' | 'oe';
const LADOS: readonly Lado[] = ['od', 'oe'];
type CampoNum = 'esferico' | 'cilindrico' | 'eixo' | 'prisma';
const CAMPOS_NUM: readonly CampoNum[] = ['esferico', 'cilindrico', 'eixo', 'prisma'];
interface OlhoForm {
  esferico: string;
  cilindrico: string;
  eixo: string;
  prisma: string;
  basePrisma: GrauOlho['basePrisma'];
  acuidade: string;
}
const olhoVazio = (): OlhoForm => ({
  esferico: '',
  cilindrico: '',
  eixo: '',
  prisma: '',
  basePrisma: null,
  acuidade: '',
});
const form = reactive({
  tipo: 'oculos' as TipoLente,
  uso: 'longe' as UsoLente,
  od: olhoVazio(),
  oe: olhoVazio(),
  adicao: '',
  dp: '',
  curvaBase: '',
  diametro: '',
  validadeAte: '',
  observacao: '',
});
const tocado = ref(false);

const tipos = computed(() =>
  TIPOS_LENTE.map((x) => ({ valor: x, rotulo: t(`especialidades.lentes.tipos.${x}`) })),
);
const usos = computed(() =>
  USOS_LENTE.map((x) => ({ valor: x, rotulo: t(`especialidades.lentes.usos.${x}`) })),
);
const bases = computed(() => [
  { valor: null, rotulo: t('especialidades.lentes.semBase') },
  ...BASES_PRISMA.map((x) => ({ valor: x, rotulo: t(`especialidades.lentes.bases.${x}`) })),
]);

const num = (s: string): number | null => (s.trim() === '' ? null : Number(s.trim().replace(',', '.')));
const texto = (v: number | null): string => (v === null ? '' : String(v).replace('.', ','));
const grauDe = (o: OlhoForm): GrauOlho => ({
  esferico: num(o.esferico),
  cilindrico: num(o.cilindrico),
  eixo: num(o.eixo),
  prisma: num(o.prisma),
  basePrisma: o.basePrisma,
  acuidade: o.acuidade.trim() || null,
});
const entrada = computed<PrescricaoLenteEntrada>(() => ({
  tipo: form.tipo,
  uso: form.uso,
  od: grauDe(form.od),
  oe: grauDe(form.oe),
  adicao: num(form.adicao),
  distanciaPupilarMm: num(form.dp),
  curvaBase: form.tipo === 'lente_contato' ? num(form.curvaBase) : null,
  diametro: form.tipo === 'lente_contato' ? num(form.diametro) : null,
  validadeAte: form.validadeAte || null,
  observacao: form.observacao.trim() || null,
}));
/** A conferência na hora: as mesmas regras que o servidor aplica na emissão. */
const erros = computed(() => conferirPrescricaoLente(entrada.value, hoje.value));
const erroDe = (campo: string): string | null =>
  tocado.value ? (erros.value.find((e) => e.campo === campo)?.mensagem ?? null) : null;
const equivalente = (l: Lado): string | null => {
  const v = equivalenteEsferico(grauDe(form[l]));
  return v === null ? null : sinal(v);
};
function transpor(l: Lado): void {
  const r = transporGrau(grauDe(form[l]));
  form[l].esferico = texto(r.esferico);
  form[l].cilindrico = texto(r.cilindrico);
  form[l].eixo = texto(r.eixo);
}

const ultima = computed(() => lista.data.value?.itens.find((x) => x.situacao !== 'rascunho') ?? null);
function repetirUltima(): void {
  const u = ultima.value;
  if (!u) return;
  form.tipo = u.tipo;
  form.uso = u.uso;
  for (const l of LADOS) {
    const o = u[l];
    form[l] = {
      esferico: texto(o.esferico),
      cilindrico: texto(o.cilindrico),
      eixo: texto(o.eixo),
      prisma: texto(o.prisma),
      basePrisma: o.basePrisma,
      acuidade: o.acuidade ?? '',
    };
  }
  form.adicao = texto(u.adicao);
  form.dp = texto(u.distanciaPupilarMm);
  form.curvaBase = texto(u.curvaBase);
  form.diametro = texto(u.diametro);
  form.validadeAte = '';
  form.observacao = u.observacao ?? '';
}

const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);
async function emitir(): Promise<void> {
  tocado.value = true;
  erro.value = null;
  mensagem.value = null;
  if (erros.value.length) return;
  ocupado.value = true;
  try {
    const r = await emitirLente({ internacao: props.reg, ...entrada.value }, novaChaveEspecialidade('lente'));
    mensagem.value = r.mensagem;
    Object.assign(form, {
      od: olhoVazio(),
      oe: olhoVazio(),
      adicao: '',
      dp: '',
      curvaBase: '',
      diametro: '',
    });
    Object.assign(form, { validadeAte: '', observacao: '' });
    tocado.value = false;
    await lista.refetch();
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}

const cancelando = ref<number | null>(null);
const motivo = ref('');
async function confirmarCancelamento(p: PrescricaoLenteLida): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = await cancelarLente(
      props.reg,
      p.id,
      { motivo: motivo.value.trim(), versao: p.versao },
      novaChaveEspecialidade('lente-cancelar'),
    );
    mensagem.value = r.mensagem;
    cancelando.value = null;
    motivo.value = '';
    await lista.refetch();
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}

const imprimindo = ref<PrescricaoLenteLida | null>(null);
async function imprimir(p: PrescricaoLenteLida): Promise<void> {
  imprimindo.value = p;
  await nextTick();
  window.print();
}

function sinal(v: number | null): string {
  if (v === null) return '-';
  const s = v.toFixed(2).replace('.', ',');
  return v > 0 ? `+${s}` : s;
}
function grauCurto(o: GrauOlho): string {
  const partes = [sinal(o.esferico)];
  if (o.cilindrico !== null && o.cilindrico !== 0) partes.push(`${sinal(o.cilindrico)} x ${o.eixo ?? '-'}°`);
  if (o.prisma)
    partes.push(
      `Δ ${texto(o.prisma)} ${o.basePrisma ? t(`especialidades.lentes.bases.${o.basePrisma}`) : ''}`,
    );
  return partes.join(' ');
}
const dataBr = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '-');
const situacaoDe = (p: PrescricaoLenteLida) =>
  p.situacao === 'emitida' ? (p.vigente ? 'vigente' : 'vencida') : p.situacao;
</script>

<template>
  <section class="painel" aria-labelledby="lentes-titulo" data-testid="lentes-painel">
    <h2 id="lentes-titulo">{{ t('especialidades.lentes.titulo') }}</h2>
    <SanteAlerta v-if="mensagem" variante="info" :texto="mensagem" anunciar data-testid="lentes-mensagem" />
    <ErroEspecialidade v-if="erro" :erro="erro" />
    <ErroEspecialidade v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value" role="status">{{ t('especialidades.carregando') }}</p>
    <p v-else-if="lista.data.value.itens.length === 0">{{ t('especialidades.lentes.nenhuma') }}</p>
    <table v-else class="tabela" data-testid="lentes-historico">
      <thead>
        <tr>
          <th
            v-for="c in ['data', 'tipo', 'od', 'oe', 'adicao', 'validade', 'situacao', 'prescritor', 'acoes']"
            :key="c"
            scope="col"
          >
            {{ t(`especialidades.lentes.colunas.${c}`) }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="p in lista.data.value.itens" :key="p.id" :data-testid="`lente-${p.id}`">
          <td>{{ dataBr(p.prescritoEm) }}</td>
          <td>
            {{ t(`especialidades.lentes.tipos.${p.tipo}`) }} · {{ t(`especialidades.lentes.usos.${p.uso}`) }}
          </td>
          <td>{{ grauCurto(p.od) }}</td>
          <td>{{ grauCurto(p.oe) }}</td>
          <td>{{ p.adicao === null ? '-' : sinal(p.adicao) }}</td>
          <td>{{ dataBr(p.validadeAte) }}</td>
          <td :data-testid="`lente-situacao-${p.id}`">
            {{ t(`especialidades.lentes.situacoes.${situacaoDe(p)}`) }}
          </td>
          <td>{{ p.profissional }}</td>
          <td class="acoes">
            <SanteBotao
              variante="texto"
              :rotulo="t('especialidades.lentes.imprimir')"
              :data-testid="`lente-imprimir-${p.id}`"
              @click="imprimir(p)"
            />
            <SanteBotao
              v-if="pode && p.situacao === 'emitida'"
              variante="texto"
              :rotulo="t('especialidades.lentes.cancelar')"
              :data-testid="`lente-cancelar-${p.id}`"
              @click="cancelando = p.id"
            />
            <form v-if="cancelando === p.id" class="formulario" @submit.prevent="confirmarCancelamento(p)">
              <SanteCampoTexto
                v-model="motivo"
                :rotulo="t('especialidades.lentes.motivo')"
                :max-bytes="500"
              />
              <SanteBotao
                tipo="submit"
                :rotulo="t('especialidades.lentes.confirmarCancelamento')"
                :desabilitado="ocupado || motivo.trim().length < 5"
                :data-testid="`lente-confirmar-${p.id}`"
              />
              <SanteBotao
                variante="texto"
                :rotulo="t('especialidades.lentes.desistir')"
                @click="cancelando = null"
              />
            </form>
          </td>
        </tr>
      </tbody>
    </table>

    <h3>{{ t('especialidades.lentes.nova') }}</h3>
    <p v-if="!pode" class="secundario">{{ motivoPode }}</p>
    <form v-else class="formulario" data-testid="form-lente" novalidate @submit.prevent="emitir">
      <SanteBotao
        v-if="ultima"
        variante="secundario"
        :rotulo="t('especialidades.lentes.repetir')"
        data-testid="lente-repetir"
        @click="repetirUltima"
      />
      <div class="grade">
        <SanteSelecao v-model="form.tipo" :rotulo="t('especialidades.lentes.tipo')" :opcoes="tipos" />
        <SanteSelecao v-model="form.uso" :rotulo="t('especialidades.lentes.uso')" :opcoes="usos" />
      </div>
      <fieldset v-for="l in LADOS" :key="l" class="grade">
        <legend>{{ t(`especialidades.lentes.olhos.${l}`) }}</legend>
        <div v-for="c in CAMPOS_NUM" v-show="c !== 'prisma' || form.tipo === 'oculos'" :key="c" class="campo">
          <label :for="`lente-${l}-${c}`">{{
            t(`especialidades.lentes.${c}`, { olho: l.toUpperCase() })
          }}</label>
          <input
            :id="`lente-${l}-${c}`"
            v-model="form[l][c]"
            type="text"
            :inputmode="c === 'eixo' ? 'numeric' : 'decimal'"
            maxlength="6"
            :aria-invalid="erroDe(`${l}.${c}`) ? 'true' : undefined"
            :aria-describedby="erroDe(`${l}.${c}`) ? `lente-${l}-${c}-erro` : undefined"
          />
          <small v-if="erroDe(`${l}.${c}`)" :id="`lente-${l}-${c}-erro`" class="alerta-texto">{{
            erroDe(`${l}.${c}`)
          }}</small>
        </div>
        <SanteSelecao
          v-if="form.tipo === 'oculos'"
          v-model="form[l].basePrisma"
          :rotulo="t('especialidades.lentes.basePrisma', { olho: l.toUpperCase() })"
          :opcoes="bases"
        />
        <small v-if="erroDe(`${l}.basePrisma`)" class="alerta-texto">{{ erroDe(`${l}.basePrisma`) }}</small>
        <SanteCampoTexto
          v-model="form[l].acuidade"
          :rotulo="t('especialidades.lentes.acuidade', { olho: l.toUpperCase() })"
          :max-bytes="10"
        />
        <p v-if="equivalente(l)" class="secundario" :data-testid="`lente-equivalente-${l}`">
          {{ t('especialidades.lentes.equivalente', { valor: equivalente(l) }) }}
        </p>
        <SanteBotao
          variante="texto"
          :rotulo="t('especialidades.lentes.transpor', { olho: l.toUpperCase() })"
          :desabilitado="!form[l].cilindrico.trim() || !form[l].eixo.trim()"
          @click="transpor(l)"
        />
      </fieldset>
      <div class="grade">
        <div v-for="c in ['adicao', 'dp'] as const" :key="c" class="campo">
          <label :for="`lente-${c}`">{{ t(`especialidades.lentes.${c}`) }}</label>
          <input
            :id="`lente-${c}`"
            v-model="form[c]"
            type="text"
            inputmode="decimal"
            maxlength="5"
            :aria-invalid="erroDe(c === 'dp' ? 'distanciaPupilarMm' : c) ? 'true' : undefined"
          />
          <small v-if="erroDe(c === 'dp' ? 'distanciaPupilarMm' : c)" class="alerta-texto">{{
            erroDe(c === 'dp' ? 'distanciaPupilarMm' : c)
          }}</small>
        </div>
        <template v-if="form.tipo === 'lente_contato'">
          <div v-for="c in ['curvaBase', 'diametro'] as const" :key="c" class="campo">
            <label :for="`lente-${c}`">{{ t(`especialidades.lentes.${c}`) }}</label>
            <input
              :id="`lente-${c}`"
              v-model="form[c]"
              type="text"
              inputmode="decimal"
              maxlength="5"
              :aria-invalid="erroDe(c) ? 'true' : undefined"
            />
            <small v-if="erroDe(c)" class="alerta-texto">{{ erroDe(c) }}</small>
          </div>
        </template>
        <div class="campo">
          <label for="lente-validade">{{ t('especialidades.lentes.validade') }}</label>
          <input id="lente-validade" v-model="form.validadeAte" type="date" :min="hoje" />
          <small v-if="erroDe('validadeAte')" class="alerta-texto">{{ erroDe('validadeAte') }}</small>
        </div>
      </div>
      <SanteCampoTexto
        v-model="form.observacao"
        :rotulo="t('especialidades.lentes.observacao')"
        :max-bytes="1000"
        multilinha
      />
      <p v-if="tocado && erros.length" class="alerta-texto" role="alert" data-testid="lente-erros">
        {{ t('especialidades.lentes.corrija') }} {{ erros.map((e) => e.mensagem).join(' ') }}
      </p>
      <SanteBotao
        tipo="submit"
        :rotulo="t('especialidades.lentes.emitir')"
        :desabilitado="ocupado"
        data-testid="lente-emitir"
      />
    </form>

    <section v-if="imprimindo" class="impressao-lente" aria-hidden="true" data-testid="lente-impressao">
      <h2>{{ t('especialidades.lentes.impressao.titulo') }}</h2>
      <p>
        {{ t('especialidades.lentes.impressao.paciente') }}: {{ paciente.nome }} ·
        {{ t('especialidades.lentes.impressao.prontuario') }}: {{ paciente.prontuario }}
      </p>
      <p>
        {{ t(`especialidades.lentes.tipos.${imprimindo.tipo}`) }} ·
        {{ t(`especialidades.lentes.usos.${imprimindo.uso}`) }}
      </p>
      <table class="tabela">
        <tbody>
          <tr v-for="l in LADOS" :key="l">
            <th scope="row">{{ t(`especialidades.lentes.olhos.${l}`) }}</th>
            <td>{{ grauCurto(imprimindo[l]) }}</td>
            <td>{{ imprimindo[l].acuidade ?? '' }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="imprimindo.adicao !== null">
        {{ t('especialidades.lentes.adicao') }}: {{ sinal(imprimindo.adicao) }}
      </p>
      <p v-if="imprimindo.distanciaPupilarMm !== null">
        {{ t('especialidades.lentes.dp') }}: {{ texto(imprimindo.distanciaPupilarMm) }}
      </p>
      <p v-if="imprimindo.tipo === 'lente_contato'">
        {{
          t('especialidades.lentes.impressao.lenteContato', {
            curva: texto(imprimindo.curvaBase),
            diametro: texto(imprimindo.diametro),
          })
        }}
      </p>
      <p v-if="imprimindo.observacao">{{ imprimindo.observacao }}</p>
      <p>
        {{ t('especialidades.lentes.impressao.data') }}: {{ dataBr(imprimindo.prescritoEm) }} ·
        {{ t('especialidades.lentes.impressao.validade') }}: {{ dataBr(imprimindo.validadeAte) }}
      </p>
      <p class="assinatura">
        {{ imprimindo.profissional
        }}<template v-if="imprimindo.registroConselho"> · {{ imprimindo.registroConselho }}</template
        ><br />{{ t('especialidades.lentes.impressao.assinatura') }}
      </p>
    </section>
  </section>
</template>

<style scoped>
.impressao-lente {
  display: none;
}
.assinatura {
  margin-top: 3rem;
  border-top: 1px solid currentColor;
  padding-top: 0.5rem;
}
@media print {
  .impressao-lente {
    display: block;
  }
}
</style>
<style>
@media print {
  body:has(.impressao-lente) * {
    visibility: hidden;
  }
  .impressao-lente,
  .impressao-lente * {
    visibility: visible;
  }
  .impressao-lente {
    position: absolute;
    inset: 0;
  }
}
</style>
