<script setup lang="ts">
// Perfil epidemiológico pela CID-10 (F7, 09-AREA linha 83): as ocorrências de diagnóstico do estabelecimento no
// período, por capítulo, grupo e subgrupo da fonte oficial, e a consulta de onde um código fica na hierarquia. Só
// contagens. O período e o código são conferidos na hora (as mesmas regras de @sgh/dominio-qualidade que a API usa);
// a lista abre já com o mês corrente, e cada capítulo se expande na própria linha (sem trocar de tela).
import '../../ccih/componentes/estilo-ccih.css';
import { normalizarCid, periodoDoPerfilCid } from '@sgh/dominio-qualidade';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ErroApi } from '../../../../casca/erros/problem-details.js';
import MensagemErro from '../../../../casca/MensagemErro.vue';
import {
  type LocalizacaoCidTela,
  lerPerfilCid,
  localizarCidNaHierarquia,
  type NoPerfilTela,
} from '../api-perfil-cid.js';

const { t } = useI18n();
const hoje = new Date().toISOString().slice(0, 10);
const filtro = reactive({
  desde: `${hoje.slice(0, 7)}-01` as string | null,
  ate: hoje as string | null,
  tipo: 'todos',
  certeza: 'confirmados',
});
const opTipo = [
  { valor: 'todos', rotulo: t('perfilCid.tipoTodos') },
  { valor: 'principal', rotulo: t('perfilCid.tipoPrincipal') },
];
const opCerteza = [
  { valor: 'confirmados', rotulo: t('perfilCid.certezaConfirmados') },
  { valor: 'suspeitos', rotulo: t('perfilCid.certezaSuspeitos') },
];
const periodo = computed(() =>
  filtro.desde && filtro.ate ? periodoDoPerfilCid(filtro.desde, filtro.ate) : null,
);
const perfil = useQuery({
  queryKey: computed(() => ['perfil-cid', periodo.value, filtro.tipo, filtro.certeza]),
  queryFn: () =>
    lerPerfilCid({
      desde: periodo.value!.desde,
      ate: periodo.value!.ate,
      principal: filtro.tipo === 'principal',
      suspeitos: filtro.certeza === 'suspeitos',
    }),
  enabled: computed(() => periodo.value !== null),
});

const abertos = ref(new Set<string>());
function alternar(codigo: string): void {
  const s = new Set(abertos.value);
  if (s.has(codigo)) s.delete(codigo);
  else s.add(codigo);
  abertos.value = s;
}
interface Linha {
  no: NoPerfilTela;
  profundidade: number;
}
/** As linhas visíveis: o capítulo e, se aberto, os grupos e subgrupos dele (em profundidade). */
const linhas = computed<Linha[]>(() => {
  const r: Linha[] = [];
  const descer = (nos: readonly NoPerfilTela[], p: number) => {
    for (const no of nos) {
      r.push({ no, profundidade: p });
      if (p > 0 || abertos.value.has(no.codigo)) descer(no.filhos, p + 1);
    }
  };
  descer(perfil.data.value?.capitulos ?? [], 0);
  return r;
});
const decimal = (v: number) =>
  v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// ── onde fica um código ──────────────────────────────────────────────────────────────────────────
const codigo = ref('');
const codigoValido = computed(() => normalizarCid(codigo.value));
const codigoTocado = computed(() => codigo.value.trim().length >= 3);
const local = ref<LocalizacaoCidTela | null>(null);
const erroLocal = ref<unknown>(null);
const foraDaHierarquia = ref(false);
async function localizar(): Promise<void> {
  local.value = null;
  erroLocal.value = null;
  foraDaHierarquia.value = false;
  if (!codigoValido.value) return;
  try {
    local.value = await localizarCidNaHierarquia(codigoValido.value);
  } catch (e) {
    if (e instanceof ErroApi && e.status === 404) foraDaHierarquia.value = true;
    else erroLocal.value = e;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="perfil-cid-titulo" data-testid="tela-perfil-cid">
    <RouterLink to="/qualidade/vigilancia/agravos" data-testid="perfil-cid-voltar">{{
      t('perfilCid.voltar')
    }}</RouterLink>
    <h1 id="perfil-cid-titulo">{{ t('perfilCid.titulo') }}</h1>
    <p class="secundario">{{ t('perfilCid.explicacao') }}</p>

    <form class="linha-ccih" data-testid="perfil-cid-filtro" @submit.prevent>
      <SanteData v-model="filtro.desde" :rotulo="t('perfilCid.desde')" editavel data-testid="perfil-desde" />
      <SanteData v-model="filtro.ate" :rotulo="t('perfilCid.ate')" editavel data-testid="perfil-ate" />
      <SanteSelecao
        v-model="filtro.tipo"
        :rotulo="t('perfilCid.tipo')"
        :opcoes="opTipo"
        data-testid="perfil-tipo"
      />
      <SanteSelecao
        v-model="filtro.certeza"
        :rotulo="t('perfilCid.certeza')"
        :opcoes="opCerteza"
        data-testid="perfil-certeza"
      />
    </form>
    <div v-if="!periodo" role="alert" data-testid="perfil-periodo-invalido">
      <SanteAlerta variante="alerta" :texto="t('perfilCid.periodoInvalido')" />
    </div>
    <MensagemErro v-if="perfil.isError.value" :erro="perfil.error.value" />
    <p v-else-if="periodo && perfil.isLoading.value" role="status">{{ t('perfilCid.carregando') }}</p>

    <template v-if="periodo && perfil.data.value">
      <dl class="resumo-perfil-cid" :aria-label="t('perfilCid.resumo.legenda')" data-testid="perfil-resumo">
        <div>
          <dt>{{ t('perfilCid.resumo.total') }}</dt>
          <dd data-testid="perfil-total">{{ perfil.data.value.total }}</dd>
        </div>
        <div>
          <dt>{{ t('perfilCid.resumo.atendimentos') }}</dt>
          <dd data-testid="perfil-atendimentos">{{ perfil.data.value.atendimentos }}</dd>
        </div>
        <div>
          <dt>{{ t('perfilCid.resumo.pacientes') }}</dt>
          <dd data-testid="perfil-pacientes">{{ perfil.data.value.pacientes }}</dd>
        </div>
        <div v-if="perfil.data.value.semCapitulo">
          <dt>{{ t('perfilCid.resumo.semCapitulo') }}</dt>
          <dd data-testid="perfil-sem-capitulo">{{ perfil.data.value.semCapitulo }}</dd>
        </div>
      </dl>
      <p v-if="!perfil.data.value.capitulos.length" data-testid="perfil-vazio">
        {{ t('perfilCid.tabela.vazio') }}
      </p>
      <table v-else class="tabela" data-testid="tabela-perfil-cid">
        <caption>
          {{
            t('perfilCid.tabela.legenda')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('perfilCid.tabela.codigo') }}</th>
            <th scope="col">{{ t('perfilCid.tabela.descricao') }}</th>
            <th scope="col" class="numero">{{ t('perfilCid.tabela.ocorrencias') }}</th>
            <th scope="col" class="numero">{{ t('perfilCid.tabela.percentual') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="l in linhas"
            :key="`${l.no.nivel}-${l.no.codigo}`"
            :class="`nivel-${l.no.nivel}`"
            :data-testid="`perfil-${l.no.nivel}-${l.no.codigo}`"
          >
            <th scope="row" :style="{ paddingInlineStart: `calc(${l.profundidade} * var(--sgh-espaco-4))` }">
              <button
                v-if="l.no.nivel === 'capitulo' && l.no.filhos.length"
                type="button"
                class="botao-texto"
                :aria-expanded="abertos.has(l.no.codigo)"
                :aria-label="
                  t(abertos.has(l.no.codigo) ? 'perfilCid.tabela.fechar' : 'perfilCid.tabela.abrir', {
                    codigo: l.no.codigo,
                  })
                "
                :data-testid="`perfil-abrir-${l.no.codigo}`"
                @click="alternar(l.no.codigo)"
              >
                {{ t('perfilCid.tabela.capitulo', { codigo: l.no.codigo }) }}
              </button>
              <span v-else-if="l.no.nivel === 'capitulo'">{{
                t('perfilCid.tabela.capitulo', { codigo: l.no.codigo })
              }}</span>
              <span v-else>{{ l.no.codigo }}</span>
            </th>
            <td>{{ l.no.descricao }}</td>
            <td class="numero" data-testid="perfil-ocorrencias">{{ l.no.diagnosticos }}</td>
            <td class="numero">{{ decimal(l.no.percentual) }}</td>
          </tr>
        </tbody>
      </table>
    </template>

    <h2>{{ t('perfilCid.cid.titulo') }}</h2>
    <form class="linha-ccih" data-testid="perfil-cid-busca" @submit.prevent="localizar">
      <SanteCampoTexto
        v-model="codigo"
        :rotulo="t('perfilCid.cid.campo')"
        :max-bytes="6"
        data-testid="perfil-cid-codigo"
      />
      <SanteBotao
        :rotulo="t('perfilCid.cid.localizar')"
        tipo="submit"
        :desabilitado="!codigoValido"
        data-testid="perfil-cid-localizar"
      />
    </form>
    <p
      v-if="codigoTocado && !codigoValido"
      class="secundario"
      role="status"
      data-testid="perfil-cid-invalido"
    >
      {{ t('perfilCid.cid.invalido') }}
    </p>
    <div v-if="foraDaHierarquia" role="alert" data-testid="perfil-cid-fora">
      <SanteAlerta variante="alerta" :texto="t('perfilCid.cid.foraDaHierarquia')" />
    </div>
    <MensagemErro v-if="erroLocal" :erro="erroLocal" />
    <dl v-if="local" class="local-cid" data-testid="perfil-cid-local">
      <div>
        <dt>{{ local.cid }}</dt>
        <dd>{{ local.descricao ?? '' }}</dd>
      </div>
      <div data-testid="local-capitulo">
        <dt>{{ t('perfilCid.cid.capitulo') }} {{ local.capitulo.codigo }}</dt>
        <dd>{{ local.capitulo.descricao }} ({{ local.capitulo.inicial }}-{{ local.capitulo.final }})</dd>
      </div>
      <div v-for="a in local.agrupamentos" :key="a.codigo" :data-testid="`local-${a.nivel}-${a.codigo}`">
        <dt>{{ t(`perfilCid.cid.${a.nivel}`) }} {{ a.codigo }}</dt>
        <dd>{{ a.descricao }}</dd>
      </div>
      <p v-if="!local.agrupamentos.length">{{ t('perfilCid.cid.semAgrupamento') }}</p>
    </dl>
  </section>
</template>

<style scoped>
.resumo-perfil-cid,
.local-cid {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-3);
}
.resumo-perfil-cid > div,
.local-cid > div {
  border: 1px solid var(--sgh-borda);
  border-radius: var(--sgh-raio);
  padding: var(--sgh-espaco-2) var(--sgh-espaco-3);
}
.local-cid {
  flex-direction: column;
}
.numero {
  text-align: end;
}
.nivel-capitulo {
  font-weight: 600;
}
.nivel-subgrupo {
  color: var(--sgh-texto-secundario);
}
.botao-texto {
  background: none;
  border: 0;
  padding: 0;
  font: inherit;
  color: inherit;
  cursor: pointer;
  text-decoration: underline;
}
</style>
