<script setup lang="ts">
// 02-AGE linha 47: cotas e prazos de marcação. Uma tela só: as cotas com o uso de hoje (quantas marcações já entraram
// na janela contra o limite, esgotada em destaque) e os prazos de aviso, cada um com a edição no próprio lugar. A
// validação é a do domínio, na hora (sem recorte, sem limite, percentual fora de 0 a 100, antecedência incoerente,
// vigência invertida); o servidor confere de novo e aplica a cota, o prazo e a restrição da agenda na marcação.
import { validarCota, validarPrazo } from '@sgh/dominio-agenda';
import { SanteBotao, SanteCampoTexto, SanteChave, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { pode as podePermissao } from '../../../casca/sessao/pode.js';
import { novaChave } from '../api-agenda.js';
import {
  ACOES,
  type CotaLida,
  lerCotasPrazos,
  lerOpcoesCota,
  PERIODICIDADES,
  type PrazoLido,
  type Recorte,
  RECORTES,
  salvarCota,
  salvarPrazo,
} from '../api-cotas-prazos.js';
import ErroAgenda from '../componentes/ErroAgenda.vue';
import { dataBr } from '../formato.js';

const { t } = useI18n();
const qc = useQueryClient();
const podeEditar = computed(() => podePermissao('agenda.cobertura.editar'));
const lista = useQuery({ queryKey: ['agenda-cotas-prazos'], queryFn: lerCotasPrazos });
const opcoes = useQuery({
  queryKey: ['agenda-cotas-prazos-opcoes'],
  queryFn: lerOpcoesCota,
  enabled: podeEditar,
});
const erro = ref<unknown>(null);
const mensagem = ref('');

const nomeDe = (r: Recorte, id: number | null) =>
  id === null ? null : (opcoes.data.value?.[r].find((o) => o.id === id)?.nome ?? `#${id}`);
const opcoesDe = (r: Recorte) => [
  { valor: '', rotulo: t('cotasPrazos.todos') },
  ...(opcoes.data.value?.[r] ?? []).map((o) => ({ valor: String(o.id), rotulo: o.nome })),
];
const idOuNulo = (v: string) => (v === '' ? null : Number(v));
/** Número inteiro do campo de texto: vazio é nulo; o que não for número fica NaN e a validação recusa na hora. */
const numeroOuNulo = (v: string) =>
  v.trim() === '' ? null : /^\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : NaN;

// ── Cota ────────────────────────────────────────────────────────────────────────────────────────────
const cotaEditando = ref<number | 'nova' | null>(null);
const cotaVersao = ref<number | null>(null);
const cf = reactive({
  agenda: '',
  fontePagadora: '',
  especialidade: '',
  tipoMarcacao: '',
  item: '',
  periodicidade: 'mes' as (typeof PERIODICIDADES)[number],
  vigenciaInicio: null as string | null,
  vigenciaFim: null as string | null,
  quantidadeMaxima: '',
  percentualMaximo: '',
  acao: 'bloquear' as (typeof ACOES)[number],
  ativo: true,
});
const texto = (n: number | null) => (n === null ? '' : String(n));
function abrirCota(c: CotaLida | null) {
  erro.value = null;
  mensagem.value = '';
  cotaEditando.value = c ? c.id : 'nova';
  cotaVersao.value = c?.versao ?? null;
  for (const r of RECORTES) cf[r] = texto(c?.[r] ?? null);
  cf.periodicidade = c?.periodicidade ?? 'mes';
  cf.vigenciaInicio = c?.vigenciaInicio ?? new Date().toISOString().slice(0, 10);
  cf.vigenciaFim = c?.vigenciaFim ?? null;
  cf.quantidadeMaxima = texto(c?.quantidadeMaxima ?? null);
  cf.percentualMaximo = texto(c?.percentualMaximo ?? null);
  cf.acao = c?.acao ?? 'bloquear';
  cf.ativo = c?.ativo ?? true;
}
const entradaCota = computed(() => ({
  agenda: idOuNulo(cf.agenda),
  fontePagadora: idOuNulo(cf.fontePagadora),
  especialidade: idOuNulo(cf.especialidade),
  tipoMarcacao: idOuNulo(cf.tipoMarcacao),
  item: idOuNulo(cf.item),
  periodicidade: cf.periodicidade,
  vigenciaInicio: cf.vigenciaInicio ?? '',
  vigenciaFim: cf.vigenciaFim,
  quantidadeMaxima: numeroOuNulo(cf.quantidadeMaxima),
  percentualMaximo: numeroOuNulo(cf.percentualMaximo),
  acao: cf.acao,
  ativo: cf.ativo,
}));
const recusaCota = computed(() => (cotaEditando.value === null ? null : validarCota(entradaCota.value)));
async function gravarCota() {
  if (recusaCota.value) return;
  erro.value = null;
  try {
    const id = cotaEditando.value === 'nova' ? null : cotaEditando.value;
    const r = await salvarCota(
      id,
      {
        ...entradaCota.value,
        ...(id !== null && cotaVersao.value !== null ? { versao: cotaVersao.value } : {}),
      },
      novaChave('cota-marcacao'),
    );
    await qc.invalidateQueries({ queryKey: ['agenda-cotas-prazos'] });
    cotaEditando.value = null;
    mensagem.value = r.mensagem ?? '';
  } catch (e) {
    erro.value = e;
  }
}
const resumoRecorte = (c: CotaLida) =>
  RECORTES.filter((r) => c[r] !== null)
    .map((r) => `${t(`cotasPrazos.recortes.${r}`)}: ${nomeDe(r, c[r])}`)
    .join('; ');
const limiteTexto = (c: CotaLida) =>
  [
    c.quantidadeMaxima !== null ? String(c.quantidadeMaxima) : null,
    c.percentualMaximo !== null ? `${c.percentualMaximo}%` : null,
  ]
    .filter(Boolean)
    .join(' / ');

// ── Prazo ───────────────────────────────────────────────────────────────────────────────────────────
const prazoEditando = ref<number | 'novo' | null>(null);
const prazoVersao = ref<number | null>(null);
const pf = reactive({
  agenda: '',
  item: '',
  antecedenciaMinimaHoras: '0',
  antecedenciaMaximaDias: '',
  textoAviso: '',
  vigenciaInicio: null as string | null,
  vigenciaFim: null as string | null,
  ativo: true,
});
function abrirPrazo(p: PrazoLido | null) {
  erro.value = null;
  mensagem.value = '';
  prazoEditando.value = p ? p.id : 'novo';
  prazoVersao.value = p?.versao ?? null;
  pf.agenda = texto(p?.agenda ?? null);
  pf.item = texto(p?.item ?? null);
  pf.antecedenciaMinimaHoras = String(p?.antecedenciaMinimaHoras ?? 0);
  pf.antecedenciaMaximaDias = texto(p?.antecedenciaMaximaDias ?? null);
  pf.textoAviso = p?.textoAviso ?? '';
  pf.vigenciaInicio = p?.vigenciaInicio ?? null;
  pf.vigenciaFim = p?.vigenciaFim ?? null;
  pf.ativo = p?.ativo ?? true;
}
const entradaPrazo = computed(() => ({
  agenda: idOuNulo(pf.agenda),
  item: idOuNulo(pf.item),
  antecedenciaMinimaHoras: numeroOuNulo(pf.antecedenciaMinimaHoras) ?? 0,
  antecedenciaMaximaDias: numeroOuNulo(pf.antecedenciaMaximaDias),
  textoAviso: pf.textoAviso.trim() ? pf.textoAviso.trim() : null,
  vigenciaInicio: pf.vigenciaInicio,
  vigenciaFim: pf.vigenciaFim,
  ativo: pf.ativo,
}));
const recusaPrazo = computed(() => (prazoEditando.value === null ? null : validarPrazo(entradaPrazo.value)));
async function gravarPrazo() {
  if (recusaPrazo.value) return;
  erro.value = null;
  try {
    const id = prazoEditando.value === 'novo' ? null : prazoEditando.value;
    const r = await salvarPrazo(
      id,
      {
        ...entradaPrazo.value,
        ...(id !== null && prazoVersao.value !== null ? { versao: prazoVersao.value } : {}),
      },
      novaChave('prazo-aviso'),
    );
    await qc.invalidateQueries({ queryKey: ['agenda-cotas-prazos'] });
    prazoEditando.value = null;
    mensagem.value = r.mensagem ?? '';
  } catch (e) {
    erro.value = e;
  }
}

const opcoesPeriodicidade = computed(() =>
  PERIODICIDADES.map((x) => ({ valor: x, rotulo: t(`cotasPrazos.periodicidades.${x}`) })),
);
const opcoesAcao = computed(() => ACOES.map((x) => ({ valor: x, rotulo: t(`cotasPrazos.acoes.${x}`) })));
</script>

<template>
  <section class="tela-agenda" aria-labelledby="cotas-prazos-titulo" data-testid="cotas-prazos">
    <h1 id="cotas-prazos-titulo">{{ t('cotasPrazos.titulo') }}</h1>
    <p>{{ t('cotasPrazos.explicacao') }}</p>
    <p v-if="lista.isPending.value">{{ t('cotasPrazos.carregando') }}</p>
    <template v-else-if="lista.data.value">
      <h2>{{ t('cotasPrazos.cotas') }}</h2>
      <p v-if="lista.data.value.cotas.length === 0" data-testid="cotas-vazio">
        {{ t('cotasPrazos.nenhumaCota') }}
      </p>
      <table v-else class="tabela" data-testid="cotas-lista">
        <thead>
          <tr>
            <th scope="col">{{ t('cotasPrazos.recorte') }}</th>
            <th scope="col">{{ t('cotasPrazos.limite') }}</th>
            <th scope="col">{{ t('cotasPrazos.acao') }}</th>
            <th scope="col">{{ t('cotasPrazos.uso') }}</th>
            <th scope="col"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in lista.data.value.cotas" :key="c.id">
            <td>
              {{ resumoRecorte(c) }}<span v-if="!c.ativo"> ({{ t('cotasPrazos.inativo') }})</span>
            </td>
            <td>{{ limiteTexto(c) }} · {{ t(`cotasPrazos.periodicidades.${c.periodicidade}`) }}</td>
            <td>{{ t(`cotasPrazos.acoes.${c.acao}`) }}</td>
            <td :data-testid="`cota-uso-${c.id}`">
              <template v-if="c.uso">
                {{
                  t('cotasPrazos.usoTexto', {
                    usadas: c.uso.usadas,
                    limite: c.uso.limite,
                    inicio: dataBr(c.uso.inicio),
                    fim: c.uso.fim.startsWith('9999') ? t('cotasPrazos.sempre') : dataBr(c.uso.fim),
                  })
                }}
                <strong v-if="c.uso.usadas >= c.uso.limite"> {{ t('cotasPrazos.esgotada') }}</strong>
              </template>
              <template v-else>{{ t('cotasPrazos.semUso') }}</template>
            </td>
            <td class="acoes">
              <SanteBotao
                v-if="podeEditar"
                variante="secundario"
                :rotulo="t('cotasPrazos.editar')"
                @acionar="abrirCota(c)"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <SanteBotao
        v-if="podeEditar && cotaEditando === null"
        :rotulo="t('cotasPrazos.novaCota')"
        data-testid="cota-nova"
        @acionar="abrirCota(null)"
      />
      <section
        v-if="cotaEditando !== null"
        class="painel"
        :aria-label="t('cotasPrazos.cotas')"
        data-testid="cota-edicao"
      >
        <div class="filtros">
          <SanteSelecao
            v-for="r in RECORTES"
            :id="`cota-${r}`"
            :key="r"
            v-model="cf[r]"
            :rotulo="t(`cotasPrazos.recortes.${r}`)"
            :opcoes="opcoesDe(r)"
          />
        </div>
        <div class="filtros">
          <SanteSelecao
            id="cota-periodicidade"
            v-model="cf.periodicidade"
            :rotulo="t('cotasPrazos.periodicidade')"
            :opcoes="opcoesPeriodicidade"
          />
          <SanteCampoTexto
            v-model="cf.quantidadeMaxima"
            :rotulo="t('cotasPrazos.quantidadeMaxima')"
            :max-bytes="7"
            data-testid="cota-quantidade"
          />
          <SanteCampoTexto
            v-model="cf.percentualMaximo"
            :rotulo="t('cotasPrazos.percentualMaximo')"
            :max-bytes="6"
            data-testid="cota-percentual"
          />
          <SanteSelecao
            id="cota-acao"
            v-model="cf.acao"
            :rotulo="t('cotasPrazos.acao')"
            :opcoes="opcoesAcao"
          />
          <SanteData v-model="cf.vigenciaInicio" :rotulo="t('cotasPrazos.vigenciaInicio')" editavel />
          <SanteData v-model="cf.vigenciaFim" :rotulo="t('cotasPrazos.vigenciaFim')" editavel />
          <SanteChave
            :ligada="cf.ativo"
            :rotulo="t('cotasPrazos.ativo')"
            @alternar="(v: boolean) => (cf.ativo = v)"
          />
        </div>
        <p v-if="recusaCota" role="alert" data-testid="cota-recusa">{{ recusaCota.mensagem }}</p>
        <div class="acoes">
          <SanteBotao
            :rotulo="t('cotasPrazos.gravarCota')"
            :desabilitado="!!recusaCota"
            data-testid="cota-gravar"
            @acionar="gravarCota"
          />
          <SanteBotao
            variante="secundario"
            :rotulo="t('cotasPrazos.cancelar')"
            @acionar="cotaEditando = null"
          />
        </div>
      </section>

      <h2>{{ t('cotasPrazos.prazos') }}</h2>
      <p v-if="lista.data.value.prazos.length === 0" data-testid="prazos-vazio">
        {{ t('cotasPrazos.nenhumPrazo') }}
      </p>
      <table v-else class="tabela" data-testid="prazos-lista">
        <thead>
          <tr>
            <th scope="col">{{ t('cotasPrazos.recorte') }}</th>
            <th scope="col">{{ t('cotasPrazos.antecedencia') }}</th>
            <th scope="col">{{ t('cotasPrazos.textoAviso') }}</th>
            <th scope="col">{{ t('cotasPrazos.vigencia') }}</th>
            <th scope="col"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in lista.data.value.prazos" :key="p.id">
            <td>
              {{
                [
                  p.agenda !== null
                    ? `${t('cotasPrazos.recortes.agenda')}: ${nomeDe('agenda', p.agenda)}`
                    : null,
                  p.item !== null ? `${t('cotasPrazos.recortes.item')}: ${nomeDe('item', p.item)}` : null,
                ]
                  .filter(Boolean)
                  .join('; ') || t('cotasPrazos.todos')
              }}<span v-if="!p.ativo"> ({{ t('cotasPrazos.inativo') }})</span>
            </td>
            <td>
              {{
                t('cotasPrazos.antecedenciaTexto', {
                  min: p.antecedenciaMinimaHoras,
                  max:
                    p.antecedenciaMaximaDias === null
                      ? t('cotasPrazos.semMaximo')
                      : t('cotasPrazos.dias', { n: p.antecedenciaMaximaDias }),
                })
              }}
            </td>
            <td>{{ p.textoAviso ?? '' }}</td>
            <td>
              {{
                t('cotasPrazos.periodo', {
                  de: p.vigenciaInicio ? dataBr(p.vigenciaInicio) : '—',
                  ate: p.vigenciaFim ? dataBr(p.vigenciaFim) : t('cotasPrazos.sempre'),
                })
              }}
            </td>
            <td class="acoes">
              <SanteBotao
                v-if="podeEditar"
                variante="secundario"
                :rotulo="t('cotasPrazos.editar')"
                @acionar="abrirPrazo(p)"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <SanteBotao
        v-if="podeEditar && prazoEditando === null"
        :rotulo="t('cotasPrazos.novoPrazo')"
        data-testid="prazo-novo"
        @acionar="abrirPrazo(null)"
      />
      <section
        v-if="prazoEditando !== null"
        class="painel"
        :aria-label="t('cotasPrazos.prazos')"
        data-testid="prazo-edicao"
      >
        <div class="filtros">
          <SanteSelecao
            id="prazo-agenda"
            v-model="pf.agenda"
            :rotulo="t('cotasPrazos.recortes.agenda')"
            :opcoes="opcoesDe('agenda')"
          />
          <SanteSelecao
            id="prazo-item"
            v-model="pf.item"
            :rotulo="t('cotasPrazos.recortes.item')"
            :opcoes="opcoesDe('item')"
          />
          <SanteCampoTexto
            v-model="pf.antecedenciaMinimaHoras"
            :rotulo="t('cotasPrazos.antecedenciaMinimaHoras')"
            :max-bytes="4"
            data-testid="prazo-minima"
          />
          <SanteCampoTexto
            v-model="pf.antecedenciaMaximaDias"
            :rotulo="t('cotasPrazos.antecedenciaMaximaDias')"
            :max-bytes="4"
            data-testid="prazo-maxima"
          />
          <SanteData v-model="pf.vigenciaInicio" :rotulo="t('cotasPrazos.vigenciaInicio')" editavel />
          <SanteData v-model="pf.vigenciaFim" :rotulo="t('cotasPrazos.vigenciaFim')" editavel />
          <SanteChave
            :ligada="pf.ativo"
            :rotulo="t('cotasPrazos.ativo')"
            @alternar="(v: boolean) => (pf.ativo = v)"
          />
        </div>
        <SanteCampoTexto
          v-model="pf.textoAviso"
          :rotulo="t('cotasPrazos.textoAviso')"
          :max-bytes="1000"
          multilinha
          data-testid="prazo-aviso"
        />
        <p v-if="recusaPrazo" role="alert" data-testid="prazo-recusa">{{ recusaPrazo.mensagem }}</p>
        <div class="acoes">
          <SanteBotao
            :rotulo="t('cotasPrazos.gravarPrazo')"
            :desabilitado="!!recusaPrazo"
            data-testid="prazo-gravar"
            @acionar="gravarPrazo"
          />
          <SanteBotao
            variante="secundario"
            :rotulo="t('cotasPrazos.cancelar')"
            @acionar="prazoEditando = null"
          />
        </div>
      </section>
    </template>
    <p v-if="mensagem" role="status" data-testid="cotas-prazos-mensagem">{{ mensagem }}</p>
    <ErroAgenda v-if="erro || lista.error.value" :erro="erro ?? lista.error.value" />
  </section>
</template>

<style src="../componentes/estilo-agenda.css"></style>
