<script setup lang="ts">
// Conferência da conta recebida (08-SGO L105, C1-100), na ficha do lote: as críticas gravadas no recebimento (as do
// lote e as das regras próprias da operadora, com a glosa automática), os pareceres da auditoria da conta
// (administrativa, médica ou de enfermagem) e os demonstrativos de análise entregues ao prestador. O parecer se
// registra aqui, com a validação do domínio na hora (texto mínimo, motivo padronizado na glosa, categoria do auditor
// designado) e só com operadora.conta.analisar. Nada se apaga: o parecer novo soma ao histórico.
import type { ContaMedicaDetalhe } from '@sgh/contratos';
import {
  PARECER_MINIMO,
  problemasDoParecerAuditoria,
  RESULTADOS_AUDITORIA_CONTA,
  TIPOS_AUDITORIA_CONTA,
  type ResultadoAuditoriaConta,
  type TipoAuditoriaConta,
} from '@sgh/dominio-operadora';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../../casca/erros/problem-details.js';
import { pode } from '../../../../casca/sessao/pode.js';
import { lerApoioRegras, lerConferencia, registrarParecer } from '../../api-conferencia-conta.js';
import { mensagensConferenciaConta } from '../../i18n-conferencia-conta.js';
import { dataBr } from '../f1/comum.js';

const props = defineProps<{
  conta: ContaMedicaDetalhe;
  /** Categoria do auditor designado que está na tela (do apoio das contas); nula sem designação. */
  categoriaAuditor: string | null;
}>();
const { t } = useI18n({ useScope: 'local', messages: { 'pt-BR': mensagensConferenciaConta } });
const cliente = useQueryClient();

const chave = computed(() => ['operadora', 'contas', 'conferencia', props.conta.id]);
const conferencia = useQuery({ queryKey: chave, queryFn: () => lerConferencia(props.conta.id) });
const podeAnalisar = computed(() => pode('operadora.conta.analisar'));
const apoio = useQuery({
  queryKey: computed(() => ['operadora', 'regras-critica', 'apoio', props.conta.operadora]),
  queryFn: () => lerApoioRegras(props.conta.operadora),
  enabled: podeAnalisar,
});

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const quando = (d: string) => `${dataBr(d.slice(0, 10))} ${d.slice(11, 16)}`;

const guia = ref<number | null>(null);
const item = ref<number | null>(null);
const tipo = ref<TipoAuditoriaConta | null>('administrativa');
const resultado = ref<ResultadoAuditoriaConta | null>(null);
const parecer = ref('');
const motivo = ref<number | null>(null);
const gravando = ref(false);
const erro = ref<string | null>(null);
const aviso = ref<string | null>(null);

const guias = computed(() =>
  props.conta.guiasDetalhe.map((g) => ({
    valor: g.id as number | null,
    rotulo: `${g.ordem} · ${g.numeroGuiaPrestador}${g.beneficiario ? ` · ${g.beneficiario.nome}` : ''}`,
  })),
);
const itens = computed(() => {
  const g = props.conta.guiasDetalhe.find((x) => x.id === guia.value);
  return [
    { valor: null as number | null, rotulo: t('conferencia.guiaInteira') },
    ...(g?.itens ?? []).map((i) => ({
      valor: i.id as number | null,
      rotulo: `${i.sequencial} · ${i.codigo} · ${i.descricao}`,
    })),
  ];
});
const tipos = TIPOS_AUDITORIA_CONTA.map((v) => ({ valor: v, rotulo: t(`conferencia.tipos.${v}`) }));
const resultados = RESULTADOS_AUDITORIA_CONTA.map((v) => ({
  valor: v,
  rotulo: t(`conferencia.resultados.${v}`),
}));
const motivos = computed(() => [
  { valor: null as number | null, rotulo: t('conferencia.semMotivo') },
  ...(apoio.data.value?.motivos ?? []).map((m) => ({
    valor: m.id as number | null,
    rotulo: `${m.codigo} · ${m.descricao}`,
  })),
]);
const categoria = computed<'medico' | 'enfermeiro' | null>(() => {
  const c = (props.categoriaAuditor ?? '').toLowerCase();
  return c.startsWith('enferm') ? 'enfermeiro' : c.startsWith('med') ? 'medico' : null;
});

/** O que falta para registrar, pelo domínio (a mesma regra que o servidor aplica), mais a guia escolhida. */
const falta = computed(() => {
  const f: string[] = [];
  if (guia.value === null) f.push(t('conferencia.problemas.guia'));
  if (tipo.value === null) f.push(t('conferencia.problemas.tipo-invalido'));
  if (resultado.value === null) f.push(t('conferencia.problemas.resultado-invalido'));
  if (tipo.value === null || resultado.value === null) return f;
  const p = problemasDoParecerAuditoria({
    tipo: tipo.value,
    resultado: resultado.value,
    parecer: parecer.value,
    motivoGlosa: motivo.value,
    situacaoConta: props.conta.situacao,
    categoriaAuditor: categoria.value,
  });
  for (const x of p) f.push(t(`conferencia.problemas.${x.codigo}`, { min: PARECER_MINIMO }));
  return f;
});

async function registrar(): Promise<void> {
  if (falta.value.length || guia.value === null || tipo.value === null || resultado.value === null) return;
  gravando.value = true;
  erro.value = null;
  aviso.value = null;
  try {
    await registrarParecer(props.conta.id, {
      guia: guia.value,
      item: item.value,
      tipo: tipo.value,
      resultado: resultado.value,
      parecer: parecer.value.trim(),
      motivoGlosa: motivo.value,
    });
    aviso.value = t('conferencia.registrado');
    parecer.value = '';
    resultado.value = null;
    motivo.value = null;
    item.value = null;
    await cliente.invalidateQueries({ queryKey: chave.value });
  } catch (e) {
    erro.value = e instanceof ErroApi && e.problema?.detail ? e.problema.detail : String(e);
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <section class="conferencia" data-testid="conta-conferencia" aria-labelledby="conta-conferencia-titulo">
    <h3 id="conta-conferencia-titulo">{{ t('conferencia.titulo') }}</h3>
    <MensagemErro v-if="conferencia.isError.value" :erro="conferencia.error.value" />
    <p v-else-if="!conferencia.data.value" role="status">{{ t('conferencia.carregando') }}</p>
    <template v-else>
      <h4>{{ t('conferencia.criticas') }}</h4>
      <p v-if="!conferencia.data.value.criticas.length" data-testid="conferencia-sem-criticas">
        {{ t('conferencia.semCriticas') }}
      </p>
      <table v-else class="conferencia__tabela" data-testid="conferencia-criticas">
        <thead>
          <tr>
            <th>{{ t('conferencia.guia') }}</th>
            <th>{{ t('conferencia.item') }}</th>
            <th>{{ t('conferencia.tipo') }}</th>
            <th>{{ t('conferencia.descricao') }}</th>
            <th>{{ t('conferencia.regra') }}</th>
            <th>{{ t('conferencia.motivo') }}</th>
            <th>{{ t('conferencia.quando') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="c in conferencia.data.value.criticas"
            :key="c.id"
            :data-testid="`conferencia-critica-${c.id}`"
          >
            <td>{{ c.numeroGuia }}</td>
            <td>{{ c.itemCodigo ?? '—' }}</td>
            <td>{{ t(`conferencia.tiposCritica.${c.tipo}`) }}</td>
            <td>{{ c.descricao }}</td>
            <td>{{ c.regra?.codigo ?? '—' }}</td>
            <td>{{ c.motivoGlosa ?? '—' }}</td>
            <td>{{ quando(c.ocorridaEm) }}</td>
          </tr>
        </tbody>
      </table>

      <h4>{{ t('conferencia.auditorias') }}</h4>
      <p v-if="!conferencia.data.value.auditorias.length" data-testid="conferencia-sem-auditorias">
        {{ t('conferencia.semAuditorias') }}
      </p>
      <ol v-else class="conferencia__lista" data-testid="conferencia-auditorias">
        <li
          v-for="a in conferencia.data.value.auditorias"
          :key="a.id"
          :data-testid="`conferencia-auditoria-${a.id}`"
        >
          <strong
            >{{ t(`conferencia.tipos.${a.tipo}`) }} · {{ t(`conferencia.resultados.${a.resultado}`) }}</strong
          >
          · {{ t('conferencia.guia') }} {{ a.numeroGuia }}
          <template v-if="a.motivoGlosa"> · {{ a.motivoGlosa }}</template>
          · {{ quando(a.registradaEm) }}<template v-if="a.auditor"> · {{ a.auditor }}</template> <br /><span
            class="conferencia__secundario"
            >{{ a.parecer }}</span
          >
        </li>
      </ol>

      <h4>{{ t('conferencia.demonstrativos') }}</h4>
      <p v-if="!conferencia.data.value.demonstrativos.length" data-testid="conferencia-sem-demonstrativos">
        {{ t('conferencia.semDemonstrativos') }}
      </p>
      <table v-else class="conferencia__tabela" data-testid="conferencia-demonstrativos">
        <thead>
          <tr>
            <th>{{ t('conferencia.numero') }}</th>
            <th>{{ t('conferencia.quando') }}</th>
            <th>{{ t('conferencia.informado') }}</th>
            <th>{{ t('conferencia.liberado') }}</th>
            <th>{{ t('conferencia.glosa') }}</th>
            <th>{{ t('conferencia.situacao') }}</th>
            <th>{{ t('conferencia.emissoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="d in conferencia.data.value.demonstrativos"
            :key="d.id"
            :data-testid="`conferencia-demonstrativo-${d.id}`"
          >
            <td>{{ d.numero }}</td>
            <td>{{ quando(d.emitidoEm) }}</td>
            <td>{{ brl(d.informado) }}</td>
            <td>{{ brl(d.liberado) }}</td>
            <td>{{ brl(d.glosa) }}</td>
            <td>{{ d.situacao }}</td>
            <td>{{ d.emissoes }}</td>
          </tr>
        </tbody>
      </table>

      <form
        v-if="podeAnalisar && conta.situacao === 'recebida'"
        class="conferencia__form"
        data-testid="conferencia-parecer"
        @submit.prevent="registrar"
      >
        <h4>{{ t('conferencia.novoParecer') }}</h4>
        <div class="conferencia__linha">
          <SanteSelecao
            id="conferencia-guia"
            v-model="guia"
            :rotulo="t('conferencia.guia')"
            :opcoes="guias"
            obrigatorio
            data-testid="conferencia-guia"
          />
          <SanteSelecao
            id="conferencia-item"
            v-model="item"
            :rotulo="t('conferencia.item')"
            :opcoes="itens"
            :desabilitado="guia === null"
            data-testid="conferencia-item"
          />
        </div>
        <div class="conferencia__linha">
          <SanteSelecao
            id="conferencia-tipo"
            v-model="tipo"
            :rotulo="t('conferencia.tipo')"
            :opcoes="tipos"
            obrigatorio
            data-testid="conferencia-tipo"
          />
          <SanteSelecao
            id="conferencia-resultado"
            v-model="resultado"
            :rotulo="t('conferencia.resultado')"
            :opcoes="resultados"
            obrigatorio
            data-testid="conferencia-resultado"
          />
          <SanteSelecao
            id="conferencia-motivo"
            v-model="motivo"
            :rotulo="t('conferencia.motivo')"
            :opcoes="motivos"
            data-testid="conferencia-motivo"
          />
        </div>
        <SanteCampoTexto
          id="conferencia-texto"
          v-model="parecer"
          :rotulo="t('conferencia.parecer')"
          :max-bytes="4000"
          multilinha
          obrigatorio
          data-testid="conferencia-texto"
        />
        <p v-if="falta.length" class="conferencia__erro" data-testid="conferencia-falta">
          {{ t('conferencia.falta', { itens: falta.join('; ') }) }}
        </p>
        <SanteAlerta v-if="erro" :texto="erro" variante="alerta" data-testid="conferencia-erro" />
        <SanteAlerta v-if="aviso" :texto="aviso" variante="info" data-testid="conferencia-aviso" />
        <SanteBotao
          :rotulo="t('conferencia.registrar')"
          tipo="submit"
          :desabilitado="falta.length > 0 || gravando"
          data-testid="conferencia-registrar"
        />
      </form>
    </template>
  </section>
</template>

<style scoped>
.conferencia,
.conferencia__form {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
}
.conferencia__linha {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: flex-end;
}
.conferencia__tabela {
  width: 100%;
  border-collapse: collapse;
}
.conferencia__tabela th,
.conferencia__tabela td {
  text-align: left;
  padding: var(--sgh-espaco-1);
  border-bottom: 1px solid var(--sgh-borda);
}
.conferencia__secundario {
  color: var(--sgh-texto-secundario);
}
.conferencia__erro {
  color: var(--sgh-alerta);
}
</style>
