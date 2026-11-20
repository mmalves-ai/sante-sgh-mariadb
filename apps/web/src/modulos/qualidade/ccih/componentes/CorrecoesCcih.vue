<script setup lang="ts">
// W0-04: as correções da ficha do internado na CCIH, cada uma num diálogo com a justificativa obrigatória:
//   - corrigir o dispositivo (tipo, sítio, inserção e a retirada já registrada) e cancelar o lançado errado (crítica:
//     senha); antes de pedir o motivo do cancelamento, a tela confere os registros que dependem dele (as fichas de IRAS
//     confirmadas que o usam como critério) e avisa quantos e quais;
//   - alterar a ficha de IRAS (critérios do sítio, microrganismo, multirresistência, data e descrição);
//   - alterar a precaução aberta (tipo, motivo e bloqueio dos vizinhos).
// No 409 da competência fechada, o diálogo oferece "reabrir competência" a quem pode.
import {
  type CriterioIras,
  type MotivoPrecaucao,
  MOTIVOS_PRECAUCAO,
  type Precaucao,
  PRECAUCOES,
  rotuloCriterioIras,
  type SitioIras,
  type TipoDispositivoInvasivo,
  TIPOS_DISPOSITIVO_INVASIVO,
} from '@sgh/contratos';
import { SanteCampoTexto, SanteData, SanteHora, SanteMarcadores, SanteOpcoes, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  alterarPrecaucao,
  cancelarDispositivo,
  corrigirDispositivo,
  corrigirIras,
  lerCompetencias,
  lerDependentesDispositivo,
  novaChaveCorrecao,
} from '../../api-correcao.js';
import DialogoCorrecao, { type PedidoCorrecao } from '../../componentes/DialogoCorrecao.vue';
import type { DispositivoTela, IrasTela, PrecaucaoTela } from '../api-ccih.js';
import { criteriosDoSitio, instanteLocal } from '../regras-ccih.js';
import DialogoReabertura from './DialogoReabertura.vue';

const emit = defineEmits<{ alterado: [texto: string] }>();
const { t } = useI18n();
const T = (k: string, p?: Record<string, unknown>) => t(`qualidade.correcao.${k}`, p ?? {});
const cliente = useQueryClient();

const competencias = useQuery({ queryKey: ['ccih', 'competencias'], queryFn: lerCompetencias });
const podeReabrir = computed(() => competencias.data.value?.acoes.reabrir ?? false);

type Modo = 'dispositivo' | 'cancelarDispositivo' | 'iras' | 'precaucao' | null;
const modo = ref<Modo>(null);
const visivel = ref(false);
const pedido = ref<PedidoCorrecao | null>(null);
const sufixo = (t: string) => t.slice(11, 16);
const dia = (t: string) => t.slice(0, 10);

// ── Dispositivo ──
const opTipo = TIPOS_DISPOSITIVO_INVASIVO.map((x) => ({
  valor: x.codigo as TipoDispositivoInvasivo,
  rotulo: x.rotulo,
}));
const disp = reactive({
  tipo: 'cvc' as TipoDispositivoInvasivo,
  sitio: '',
  data: null as string | null,
  hora: null as string | null,
  retData: null as string | null,
  retHora: null as string | null,
  retirado: false,
});
function corrigirDisp(d: DispositivoTela): void {
  Object.assign(disp, {
    tipo: d.tipo,
    sitio: d.sitio ?? '',
    data: dia(d.inseridoEm),
    hora: sufixo(d.inseridoEm),
    retData: d.retiradoEm ? dia(d.retiradoEm) : null,
    retHora: d.retiradoEm ? sufixo(d.retiradoEm) : null,
    retirado: d.retiradoEm !== null,
  });
  modo.value = 'dispositivo';
  pedido.value = {
    titulo: T('dispositivo.corrigirTitulo'),
    critica: false,
    confirmar: T('dispositivo.confirmarCorrecao'),
    gravar: ({ justificativa, senha }) =>
      corrigirDispositivo(
        d.id,
        {
          versao: d.versao,
          tipo: disp.tipo,
          sitio: disp.sitio.trim() || null,
          inseridoEm: instanteLocal(disp.data, disp.hora) ?? '',
          retiradoEm: disp.retirado ? instanteLocal(disp.retData, disp.retHora) : null,
          justificativa,
          ...(senha ? { senha } : {}),
        },
        novaChaveCorrecao('dispositivo'),
      ),
  };
  visivel.value = true;
}
const dispValido = computed(
  () =>
    !!instanteLocal(disp.data, disp.hora) && (!disp.retirado || !!instanteLocal(disp.retData, disp.retHora)),
);

async function cancelarDisp(d: DispositivoTela): Promise<void> {
  modo.value = 'cancelarDispositivo';
  const base: PedidoCorrecao = {
    titulo: T('dispositivo.cancelarTitulo'),
    texto: T('dispositivo.cancelarTexto'),
    alerta: T('dependentes.carregando'),
    critica: true,
    impedido: true,
    confirmar: T('dispositivo.confirmarCancelamento'),
    gravar: (m) => cancelarDispositivo(d.id, d.versao, m, novaChaveCorrecao('cancelar-dispositivo')),
  };
  pedido.value = base;
  visivel.value = true;
  try {
    const dep = await lerDependentesDispositivo(d.id);
    pedido.value = dep.podeCancelar
      ? { ...base, alerta: undefined, impedido: false }
      : {
          ...base,
          impedido: true,
          alerta: [
            T('dependentes.impedem'),
            ...dep.itens.map((x) =>
              T('dependentes.item', { grupo: x.grupo, n: x.quantidade, ids: x.ids.join(', nº ') }),
            ),
          ].join(' '),
        };
  } catch {
    // Sem a conferência prévia, o servidor recusa o órfão do mesmo jeito (409 com a lista).
    pedido.value = { ...base, alerta: undefined, impedido: false };
  }
}

// ── Ficha de IRAS ──
const iras = reactive({
  sitio: 'ipcs' as SitioIras,
  data: null as string | null,
  criterios: [] as CriterioIras[],
  microrganismo: '',
  multirresistente: false,
  descricao: '',
});
const opCriterios = computed(() =>
  criteriosDoSitio(iras.sitio).map((c) => ({ valor: c, rotulo: rotuloCriterioIras(c) })),
);
function alterarIrasFicha(x: IrasTela): void {
  Object.assign(iras, {
    sitio: x.sitio as SitioIras,
    data: dia(x.dataInfeccao),
    criterios: [...x.criterios] as CriterioIras[],
    microrganismo: x.microrganismo ?? '',
    multirresistente: x.multirresistente,
    descricao: x.descricao ?? '',
  });
  modo.value = 'iras';
  pedido.value = {
    titulo: T('iras.alterarTitulo'),
    critica: false,
    confirmar: T('iras.confirmar'),
    gravar: ({ justificativa }) =>
      corrigirIras(
        x.id,
        {
          versao: x.versao,
          dataInfeccao: iras.data ?? '',
          criterios: iras.criterios as never,
          microrganismo: iras.microrganismo.trim() || null,
          multirresistente: iras.multirresistente,
          descricao: iras.descricao.trim() || null,
          justificativa,
        },
        novaChaveCorrecao('iras'),
      ),
  };
  visivel.value = true;
}
const irasValida = computed(
  () =>
    !!iras.data &&
    iras.criterios.length > 0 &&
    (!iras.multirresistente || iras.microrganismo.trim().length > 0),
);

// ── Precaução ──
const prec = reactive({
  tipo: 'contato' as Precaucao,
  motivo: 'outro' as MotivoPrecaucao,
  motivoOutro: '',
  bloquearVizinhos: false,
});
const opPrecTipo = PRECAUCOES.map((p) => ({ valor: p.codigo as Precaucao, rotulo: p.rotulo }));
const opPrecMotivo = MOTIVOS_PRECAUCAO.map((m) => ({ valor: m.codigo as MotivoPrecaucao, rotulo: m.rotulo }));
function alterarPrec(p: PrecaucaoTela): void {
  Object.assign(prec, {
    tipo: p.tipo,
    motivo: p.motivo as MotivoPrecaucao,
    motivoOutro: p.motivoOutro ?? '',
    bloquearVizinhos: p.bloqueios.length > 0,
  });
  modo.value = 'precaucao';
  pedido.value = {
    titulo: T('precaucao.alterarTitulo'),
    texto: T('precaucao.texto'),
    critica: false,
    confirmar: T('precaucao.confirmar'),
    gravar: ({ justificativa, senha }) =>
      alterarPrecaucao(
        p.id,
        {
          versao: p.versao,
          tipo: prec.tipo,
          motivo: prec.motivo,
          motivoOutro: prec.motivo === 'outro' ? prec.motivoOutro.trim() || null : null,
          bloquearVizinhos: prec.bloquearVizinhos,
          justificativa,
          ...(senha ? { senha } : {}),
        },
        novaChaveCorrecao('precaucao'),
      ),
  };
  visivel.value = true;
}
const precValida = computed(() => prec.motivo !== 'outro' || prec.motivoOutro.trim().length >= 3);

const valido = computed(() => {
  if (modo.value === 'dispositivo') return dispValido.value;
  if (modo.value === 'iras') return irasValida.value;
  if (modo.value === 'precaucao') return precValida.value;
  return true;
});

async function feito(): Promise<void> {
  await cliente.invalidateQueries({ queryKey: ['ccih'] });
  emit('alterado', modo.value === 'cancelarDispositivo' ? T('cancelado') : T('gravado'));
}

// ── Reabertura oferecida no 409 ──
const reabrindo = ref(false);
const competencia = ref<string | null>(null);
function reabrir(cs: string[]): void {
  competencia.value = cs[0] ?? null;
  reabrindo.value = competencia.value !== null;
}

defineExpose({
  corrigirDispositivo: corrigirDisp,
  cancelarDispositivo: cancelarDisp,
  alterarIras: alterarIrasFicha,
  alterarPrecaucao: alterarPrec,
});
</script>

<template>
  <DialogoCorrecao
    v-model:visivel="visivel"
    :pedido="pedido"
    :valido="valido"
    :pode-reabrir="podeReabrir"
    @feito="feito"
    @reabrir="reabrir"
  >
    <div v-if="modo === 'dispositivo'" class="campos-correcao" data-testid="correcao-dispositivo">
      <SanteSelecao
        v-model="disp.tipo"
        :rotulo="t('ccih.ficha.tipo')"
        :opcoes="opTipo"
        obrigatorio
        data-testid="correcao-dispositivo-tipo"
      />
      <SanteCampoTexto v-model="disp.sitio" :rotulo="t('ccih.ficha.sitio')" :max-bytes="40" />
      <SanteData v-model="disp.data" :rotulo="t('ccih.ficha.inseridoEm')" editavel />
      <SanteHora v-model="disp.hora" :rotulo="t('ccih.ficha.horaInsercao')" editavel />
      <template v-if="disp.retirado">
        <SanteData v-model="disp.retData" :rotulo="T('dispositivo.retiradoEm')" editavel />
        <SanteHora v-model="disp.retHora" :rotulo="T('dispositivo.horaRetirada')" editavel />
      </template>
    </div>
    <div v-else-if="modo === 'iras'" class="campos-correcao" data-testid="correcao-iras">
      <SanteData v-model="iras.data" :rotulo="t('ccih.iras.dataInfeccao')" editavel />
      <SanteMarcadores
        v-model="iras.criterios"
        :legenda="t('ccih.iras.criterios')"
        :opcoes="opCriterios"
        data-testid="correcao-iras-criterios"
      />
      <SanteCampoTexto
        v-model="iras.microrganismo"
        :rotulo="t('ccih.iras.microrganismo')"
        :max-bytes="80"
        data-testid="correcao-iras-microrganismo"
      />
      <label class="marca">
        <input v-model="iras.multirresistente" type="checkbox" data-testid="correcao-iras-mr" />
        {{ t('ccih.iras.multirresistente') }}
      </label>
      <SanteCampoTexto
        v-model="iras.descricao"
        :rotulo="t('ccih.iras.descricao')"
        :max-bytes="1000"
        multilinha
      />
    </div>
    <div v-else-if="modo === 'precaucao'" class="campos-correcao" data-testid="correcao-precaucao">
      <SanteSelecao
        v-model="prec.motivo"
        :rotulo="t('ccih.precaucoes.motivo')"
        :opcoes="opPrecMotivo"
        obrigatorio
        busca
        data-testid="correcao-precaucao-motivo"
      />
      <SanteCampoTexto
        v-if="prec.motivo === 'outro'"
        v-model="prec.motivoOutro"
        :rotulo="t('ccih.precaucoes.motivoOutro')"
        :max-bytes="60"
      />
      <SanteOpcoes
        v-model="prec.tipo"
        :legenda="t('ccih.precaucoes.tipo')"
        :opcoes="opPrecTipo"
        nome="correcao-precaucao-tipo"
      />
      <label class="marca">
        <input v-model="prec.bloquearVizinhos" type="checkbox" data-testid="correcao-precaucao-bloquear" />
        {{ T('precaucao.bloquearVizinhos') }}
      </label>
    </div>
  </DialogoCorrecao>
  <DialogoReabertura
    v-model:visivel="reabrindo"
    :competencia="competencia"
    @feito="(x) => emit('alterado', x)"
  />
</template>

<style scoped>
.campos-correcao {
  display: grid;
  gap: var(--sgh-espaco-2);
}
.marca {
  display: inline-flex;
  gap: var(--sgh-espaco-2);
  align-items: center;
}
</style>
