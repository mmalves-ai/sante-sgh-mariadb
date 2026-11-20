<script setup lang="ts">
// W0-04: as correções da gestão da qualidade, cada uma num diálogo com a justificativa obrigatória:
//   - auditoria interna: alterar com versão (o checklist inteiro, a conclusão e os dados) e cancelar (crítica);
//   - reunião de comissão: retificar a ata (nova versão), assinar a ata (crítica, sem justificativa: é aprovação) e
//     cancelar a reunião lançada errado (crítica; a de ata assinada não se cancela);
//   - não conformidade: cancelar a duplicada (apontando a original) ou a aberta por engano (crítica);
//   - manifestação da ouvidoria: corrigir tipo, área e relato antes do encaminhamento e cancelar (crítica; lógico).
import {
  RESULTADOS_ITEM_AUDITORIA,
  type ResultadoItemAuditoria,
  TIPOS_MANIFESTACAO,
  type TipoManifestacao,
} from '@sgh/contratos';
import { SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  alterarAuditoria,
  assinarAta,
  cancelarAuditoria,
  cancelarManifestacao,
  cancelarNaoConformidade,
  cancelarReuniao,
  corrigirManifestacao,
  novaChaveCorrecao,
  retificarAta,
} from '../../api-correcao.js';
import DialogoCorrecao, { type PedidoCorrecao } from '../../componentes/DialogoCorrecao.vue';
import type { AuditoriaTela, ManifestacaoTela, NaoConformidadeTela, ReuniaoTela } from '../api-gestao.js';

const emit = defineEmits<{ alterado: [texto: string] }>();
const { t } = useI18n();
const T = (k: string, p?: Record<string, unknown>) => t(`qualidade.correcao.${k}`, p ?? {});
const cliente = useQueryClient();

type Modo = 'auditoria' | 'ata' | 'nc' | 'manifestacao' | 'simples' | null;
const modo = ref<Modo>(null);
const visivel = ref(false);
const pedido = ref<PedidoCorrecao | null>(null);
const textoFeito = ref('');
function abrir(m: Modo, p: PedidoCorrecao, feito: string): void {
  modo.value = m;
  pedido.value = p;
  textoFeito.value = feito;
  visivel.value = true;
}

// ── Auditoria ──
const opResultado = RESULTADOS_ITEM_AUDITORIA.map((r) => ({
  valor: r.codigo as ResultadoItemAuditoria,
  rotulo: r.rotulo,
}));
const aud = reactive({
  titulo: '',
  area: '',
  realizadaEm: null as string | null,
  auditores: '',
  conclusao: '',
  itens: [] as {
    requisito: string;
    secao: string | null;
    resultado: ResultadoItemAuditoria;
    evidencia: string;
  }[],
});
function alterarAud(a: AuditoriaTela): void {
  Object.assign(aud, {
    titulo: a.titulo,
    area: a.area,
    realizadaEm: a.realizadaEm.slice(0, 10),
    auditores: a.auditores,
    conclusao: a.conclusao,
    itens: a.itens.map((i) => ({
      requisito: i.requisito,
      secao: i.secao ?? null,
      resultado: i.resultado as ResultadoItemAuditoria,
      evidencia: i.evidencia ?? '',
    })),
  });
  abrir(
    'auditoria',
    {
      titulo: T('auditoria.alterarTitulo'),
      critica: false,
      confirmar: T('auditoria.confirmarAlteracao'),
      gravar: ({ justificativa }) =>
        alterarAuditoria(
          a.id,
          {
            versao: a.versao,
            titulo: aud.titulo.trim(),
            area: aud.area.trim(),
            realizadaEm: aud.realizadaEm ?? '',
            auditores: aud.auditores.trim(),
            itens: aud.itens.map((i) => ({
              requisito: i.requisito,
              secao: i.secao,
              resultado: i.resultado,
              evidencia: i.evidencia.trim() || null,
            })),
            conclusao: aud.conclusao.trim(),
            justificativa,
          },
          novaChaveCorrecao('auditoria'),
        ),
    },
    T('gravado'),
  );
}
const audValida = computed(
  () =>
    aud.titulo.trim().length >= 5 &&
    aud.area.trim().length >= 2 &&
    !!aud.realizadaEm &&
    aud.auditores.trim().length >= 3 &&
    aud.conclusao.trim().length >= 10,
);
function cancelarAud(a: AuditoriaTela): void {
  abrir(
    'simples',
    {
      titulo: T('auditoria.cancelarTitulo'),
      texto: T('auditoria.cancelarTexto'),
      critica: true,
      confirmar: T('auditoria.confirmarCancelamento'),
      gravar: (m) => cancelarAuditoria(a.id, a.versao, m, novaChaveCorrecao('cancelar-auditoria')),
    },
    T('cancelado'),
  );
}

// ── Reunião e ata ──
const ata = reactive({
  pauta: '',
  ata: '',
  presentes: '',
  convidados: '',
  deliberacoes: '',
});
let membros: readonly string[] = [];
function indicesPresentes(): number[] {
  const nomes = ata.presentes
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  return membros.flatMap((m, i) => (nomes.includes(m.trim().toLowerCase()) ? [i] : []));
}
function retificar(r: ReuniaoTela, nomesMembros: readonly string[]): void {
  membros = nomesMembros;
  Object.assign(ata, {
    pauta: r.pauta,
    ata: r.ata,
    presentes: r.presentes.join(', '),
    convidados: r.convidados ?? '',
    deliberacoes: r.deliberacoes ?? '',
  });
  abrir(
    'ata',
    {
      titulo: T('reuniao.retificarTitulo'),
      // Revisão do W0-04: a ata assinada se retifica com a senha, e a assinatura sai do texto novo.
      texto: r.ataAssinadaEm ? T('reuniao.retificarAssinadaTexto') : T('reuniao.retificarTexto'),
      critica: !!r.ataAssinadaEm,
      confirmar: T('reuniao.confirmarRetificacao'),
      gravar: ({ justificativa, senha }) =>
        retificarAta(
          r.id,
          {
            versao: r.versao,
            pauta: ata.pauta.trim(),
            ata: ata.ata.trim(),
            presentes: indicesPresentes(),
            convidados: ata.convidados.trim() || null,
            deliberacoes: ata.deliberacoes.trim() || null,
            justificativa,
            ...(senha ? { senha } : {}),
          },
          novaChaveCorrecao('ata'),
        ),
    },
    T('gravado'),
  );
}
const ataValida = computed(() => ata.pauta.trim().length >= 5 && ata.ata.trim().length >= 20);
function assinar(r: ReuniaoTela): void {
  abrir(
    'simples',
    {
      titulo: T('reuniao.assinarTitulo'),
      texto: T('reuniao.assinarTexto'),
      semJustificativa: true,
      critica: true,
      confirmar: T('reuniao.confirmarAssinatura'),
      gravar: ({ senha }) => assinarAta(r.id, r.versao, senha, novaChaveCorrecao('assinar-ata')),
    },
    T('assinada'),
  );
}
function cancelarReun(r: ReuniaoTela): void {
  abrir(
    'simples',
    {
      titulo: T('reuniao.cancelarTitulo'),
      texto: T('reuniao.cancelarTexto'),
      critica: true,
      confirmar: T('reuniao.confirmarCancelamento'),
      gravar: (m) => cancelarReuniao(r.id, r.versao, m, novaChaveCorrecao('cancelar-reuniao')),
    },
    T('cancelado'),
  );
}

// ── Não conformidade ──
const nc = reactive({ duplicada: false, original: null as number | null });
const opOriginais = ref<{ valor: number | null; rotulo: string }[]>([]);
function cancelarNc(x: NaoConformidadeTela, candidatas: readonly NaoConformidadeTela[]): void {
  Object.assign(nc, { duplicada: false, original: null });
  opOriginais.value = candidatas
    .filter((c) => c.id !== x.id && !c.canceladaEm)
    .map((c) => ({
      valor: c.id as number | null,
      rotulo: `nº ${String(c.id)} · ${c.descricao.slice(0, 60)}`,
    }));
  abrir(
    'nc',
    {
      titulo: T('naoConformidade.cancelarTitulo'),
      texto: T('naoConformidade.cancelarTexto'),
      critica: true,
      confirmar: T('naoConformidade.confirmar'),
      gravar: (m) =>
        cancelarNaoConformidade(
          x.id,
          x.versao,
          nc.duplicada ? nc.original : null,
          m,
          novaChaveCorrecao('cancelar-nc'),
        ),
    },
    T('cancelado'),
  );
}
const ncValida = computed(() => !nc.duplicada || nc.original !== null);

// ── Manifestação ──
const opTipoManifestacao = TIPOS_MANIFESTACAO.map((x) => ({
  valor: x.codigo as TipoManifestacao,
  rotulo: x.rotulo,
}));
const man = reactive({ tipo: 'reclamacao' as TipoManifestacao, area: '', relato: '' });
function corrigirMan(m: ManifestacaoTela): void {
  Object.assign(man, { tipo: m.tipo, area: m.area, relato: m.relato });
  abrir(
    'manifestacao',
    {
      titulo: T('manifestacao.corrigirTitulo'),
      texto: T('manifestacao.corrigirTexto'),
      critica: false,
      confirmar: T('manifestacao.confirmarCorrecao'),
      gravar: ({ justificativa }) =>
        corrigirManifestacao(
          m.id,
          {
            versao: m.versao,
            tipo: man.tipo,
            area: man.area.trim(),
            relato: man.relato.trim(),
            justificativa,
          },
          novaChaveCorrecao('manifestacao'),
        ),
    },
    T('gravado'),
  );
}
const manValida = computed(() => man.area.trim().length >= 2 && man.relato.trim().length >= 10);
function cancelarMan(m: ManifestacaoTela): void {
  abrir(
    'simples',
    {
      titulo: T('manifestacao.cancelarTitulo'),
      texto: T('manifestacao.cancelarTexto'),
      critica: true,
      confirmar: T('manifestacao.confirmarCancelamento'),
      gravar: (x) => cancelarManifestacao(m.id, m.versao, x, novaChaveCorrecao('cancelar-manifestacao')),
    },
    T('cancelado'),
  );
}

const valido = computed(() => {
  if (modo.value === 'auditoria') return audValida.value;
  if (modo.value === 'ata') return ataValida.value;
  if (modo.value === 'nc') return ncValida.value;
  if (modo.value === 'manifestacao') return manValida.value;
  return true;
});

async function feito(): Promise<void> {
  await cliente.invalidateQueries({ queryKey: ['gestaoQualidade'] });
  emit('alterado', textoFeito.value);
}

defineExpose({
  alterarAuditoria: alterarAud,
  cancelarAuditoria: cancelarAud,
  retificarAta: retificar,
  assinarAta: assinar,
  cancelarReuniao: cancelarReun,
  cancelarNaoConformidade: cancelarNc,
  corrigirManifestacao: corrigirMan,
  cancelarManifestacao: cancelarMan,
});
</script>

<template>
  <DialogoCorrecao v-model:visivel="visivel" :pedido="pedido" :valido="valido" @feito="feito">
    <div v-if="modo === 'auditoria'" class="campos-correcao" data-testid="correcao-auditoria">
      <SanteCampoTexto
        v-model="aud.titulo"
        :rotulo="t('gestaoQualidade.auditorias.colTitulo')"
        :max-bytes="200"
        data-testid="correcao-aud-titulo"
      />
      <SanteCampoTexto v-model="aud.area" :rotulo="t('gestaoQualidade.area')" :max-bytes="80" />
      <SanteData v-model="aud.realizadaEm" :rotulo="t('gestaoQualidade.auditorias.colData')" editavel />
      <SanteCampoTexto
        v-model="aud.auditores"
        :rotulo="t('gestaoQualidade.auditorias.detalhe.auditores')"
        :max-bytes="400"
      />
      <fieldset v-for="(i, k) in aud.itens" :key="k" class="item">
        <legend>{{ i.secao ? `${i.secao} · ` : '' }}{{ i.requisito }}</legend>
        <SanteSelecao
          v-model="i.resultado"
          :rotulo="t('gestaoQualidade.auditorias.detalhe.colResultado')"
          :opcoes="opResultado"
          :data-testid="`correcao-aud-resultado-${k}`"
        />
        <SanteCampoTexto
          v-model="i.evidencia"
          :rotulo="t('gestaoQualidade.auditorias.detalhe.colEvidencia')"
          :max-bytes="600"
        />
      </fieldset>
      <SanteCampoTexto
        v-model="aud.conclusao"
        :rotulo="t('gestaoQualidade.auditorias.detalhe.conclusao')"
        :max-bytes="2000"
        multilinha
      />
    </div>
    <div v-else-if="modo === 'ata'" class="campos-correcao" data-testid="correcao-ata">
      <SanteCampoTexto
        v-model="ata.pauta"
        :rotulo="t('gestaoQualidade.comissoes.pauta')"
        :max-bytes="2000"
        multilinha
      />
      <SanteCampoTexto
        v-model="ata.ata"
        :rotulo="t('gestaoQualidade.comissoes.ata')"
        :max-bytes="8000"
        multilinha
        data-testid="correcao-ata-texto"
      />
      <SanteCampoTexto v-model="ata.presentes" :rotulo="T('reuniao.presentes')" :max-bytes="2000" />
      <SanteCampoTexto
        v-model="ata.convidados"
        :rotulo="t('gestaoQualidade.comissoes.convidados')"
        :max-bytes="400"
      />
      <SanteCampoTexto
        v-model="ata.deliberacoes"
        :rotulo="t('gestaoQualidade.comissoes.deliberacoes')"
        :max-bytes="2000"
        multilinha
      />
    </div>
    <div v-else-if="modo === 'nc'" class="campos-correcao" data-testid="correcao-nc">
      <label class="marca">
        <input v-model="nc.duplicada" type="checkbox" data-testid="correcao-nc-duplicada" />
        {{ T('naoConformidade.duplicada') }}
      </label>
      <SanteSelecao
        v-if="nc.duplicada"
        v-model="nc.original"
        :rotulo="T('naoConformidade.original')"
        :opcoes="opOriginais"
        busca
        obrigatorio
        data-testid="correcao-nc-original"
      />
    </div>
    <div v-else-if="modo === 'manifestacao'" class="campos-correcao" data-testid="correcao-manifestacao">
      <SanteSelecao
        v-model="man.tipo"
        :rotulo="t('gestaoQualidade.ouvidoria.tipo')"
        :opcoes="opTipoManifestacao"
        obrigatorio
        data-testid="correcao-man-tipo"
      />
      <SanteCampoTexto
        v-model="man.area"
        :rotulo="t('gestaoQualidade.area')"
        :max-bytes="80"
        data-testid="correcao-man-area"
      />
      <SanteCampoTexto
        v-model="man.relato"
        :rotulo="t('gestaoQualidade.ouvidoria.form.relato')"
        :max-bytes="4000"
        multilinha
      />
    </div>
  </DialogoCorrecao>
</template>

<style scoped>
.campos-correcao {
  display: grid;
  gap: var(--sgh-espaco-2);
}
.item {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda);
  padding: var(--sgh-espaco-2);
}
.marca {
  display: inline-flex;
  gap: var(--sgh-espaco-2);
  align-items: center;
}
</style>
