<script setup lang="ts">
// Aba "Parâmetros" das obrigações (M53.8, etapa F7; consulta com `pessoas.obrigacao.ler`; nova vigência com
// `pessoas.obrigacao.gerar`; DP-47: leiaute e marcos legais em parâmetro, nunca constante): as vigências por empresa,
// da mais nova para a mais antiga, com o regime de cada obrigação (exigida de/até, leiaute, conferido). A vigência nova
// parte da em vigor (a correção) ou da sugestão com as fontes, que não vale até ser gravada (D-LEIAUTE-538: o leiaute
// nasce não conferido; depois da conferência no programa oficial, uma vigência nova o marca conferido).
import {
  type ApoioObrigacoes,
  type ParametrosObrigacoesLidos,
  TIPOS_OBRIGACAO,
  type TipoObrigacao,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { competenciasAte, instanteBr, rotuloCompetencia } from '../comum-folha.js';
import ErroFolha from '../telas/ErroFolha.vue';
import { lerParametrosObrigacoes, registrarParametrosObrigacoes } from './api-obrigacoes.js';
import {
  anual,
  conferirFormParametros,
  type FormParametrosObrigacoes,
  formDosParametros,
  regimesDaSugestao,
} from './comum-obrigacoes.js';

const props = defineProps<{ apoio: ApoioObrigacoes; empresa: number; pode: boolean; hoje: string }>();
const { t, te } = useI18n();
const cliente = useQueryClient();
const B = 'folha.obrigacoes.recusa';
const q = useQuery({
  queryKey: computed(() => ['folha', 'obrigacoes', 'parametros', props.empresa]),
  queryFn: () => lerParametrosObrigacoes(props.empresa),
});
const vigencias = computed<readonly ParametrosObrigacoesLidos[]>(() =>
  [...(q.data.value?.itens ?? [])].sort((a, b) => b.inicio.localeCompare(a.inicio)),
);
const hojeComp = props.hoje.slice(0, 7);
const textoLimite = (s: string | null, fim: boolean) =>
  s ? s : fim ? t('folha.obrigacoes.parametros.vazioAte') : t('folha.obrigacoes.parametros.vazioDe');

const aberto = ref(false);
const f = ref<FormParametrosObrigacoes>(formDosParametros(null, props.apoio.regimesSugeridos, hojeComp));
const aviso = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);
const tentou = ref(false);
function nova(): void {
  f.value = formDosParametros(vigencias.value[0] ?? null, props.apoio.regimesSugeridos, hojeComp);
  erro.value = null;
  aviso.value = null;
  tentou.value = false;
  aberto.value = true;
}
function usarSugestao(): void {
  f.value = { ...f.value, regimes: regimesDaSugestao(props.apoio.regimesSugeridos) };
}
// A vigência pode começar em qualquer competência antiga (a SEFIP e o CAGED são de períodos passados).
const opcoesInicio = competenciasAte(`${Number(hojeComp.slice(0, 4)) + 1}-12-01`, 12 * 15).map((c) => ({
  valor: c,
  rotulo: rotuloCompetencia(c),
}));
const opcoesConferido = computed(() => [
  { valor: 'nao', rotulo: t('folha.obrigacoes.parametros.naoConferido') },
  { valor: 'sim', rotulo: t('folha.obrigacoes.parametros.simConferido') },
]);
const conferido = (tp: TipoObrigacao) => (f.value.regimes[tp].leiauteConferido ? 'sim' : 'nao');
function definirConferido(tp: TipoObrigacao, v: string): void {
  f.value.regimes[tp] = { ...f.value.regimes[tp], leiauteConferido: v === 'sim' };
}
const conferencia = computed(() => conferirFormParametros(props.empresa, f.value));
const camposInvalidos = computed(() =>
  conferencia.value.ok
    ? ''
    : conferencia.value.campos
        .map((c) => {
          if (c.startsWith('regimes.')) return t(`folha.obrigacoes.tipos.${c.slice(8)}`);
          const k = `folha.obrigacoes.parametros.${c === 'nome' ? 'contatoNome' : c}`;
          return te(k) ? t(k) : c;
        })
        .join(', '),
);
async function gravar(): Promise<void> {
  tentou.value = true;
  if (!conferencia.value.ok) return;
  erro.value = null;
  ocupado.value = true;
  try {
    await registrarParametrosObrigacoes(conferencia.value.dados);
    aberto.value = false;
    aviso.value = t('folha.obrigacoes.parametros.gravada', { inicio: rotuloCompetencia(f.value.inicio) });
    await cliente.invalidateQueries({ queryKey: ['folha', 'obrigacoes'] });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section
    class="bloco"
    :aria-label="t('folha.obrigacoes.parametros.titulo')"
    data-testid="obrigacoes-parametros"
  >
    <h2>{{ t('folha.obrigacoes.parametros.titulo') }}</h2>
    <p class="secundario">{{ t('folha.obrigacoes.parametros.ajuda') }}</p>
    <SanteAlerta
      v-if="aviso"
      :texto="aviso"
      variante="info"
      anunciar
      data-testid="obrigacoes-parametros-aviso"
    />
    <ErroFolha v-if="erro && !aberto" :erro="erro" :base="B" />
    <div v-if="pode" class="acoes">
      <SanteBotao
        :rotulo="t('folha.obrigacoes.parametros.nova')"
        variante="secundario"
        data-testid="obrigacoes-parametros-nova"
        @acionar="nova"
      />
    </div>
    <ErroFolha v-if="q.isError.value" :erro="q.error.value" :base="B" />
    <p v-else-if="!q.data.value" role="status">{{ t('folha.obrigacoes.carregando') }}</p>
    <p v-else-if="vigencias.length === 0" data-testid="obrigacoes-parametros-vazio">
      {{ t('folha.obrigacoes.parametros.nenhum') }}
    </p>
    <div
      v-else
      class="rolagem"
      tabindex="0"
      role="region"
      :aria-label="t('folha.obrigacoes.parametros.vigencias')"
    >
      <table class="tabela">
        <thead>
          <tr>
            <th scope="col">{{ t('folha.obrigacoes.parametros.inicio') }}</th>
            <th scope="col">{{ t('folha.obrigacoes.parametros.razaoSocial') }}</th>
            <th v-for="tp in TIPOS_OBRIGACAO" :key="tp" scope="col">
              {{ t(`folha.obrigacoes.tipos.${tp}`) }}
            </th>
            <th scope="col">{{ t('folha.obrigacoes.registro') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="v in vigencias" :key="v.id" :data-testid="`obrigacoes-vigencia-${v.inicio}`">
            <th scope="row">{{ rotuloCompetencia(v.inicio) }}</th>
            <td>{{ v.razaoSocial }}</td>
            <td
              v-for="tp in TIPOS_OBRIGACAO"
              :key="tp"
              :data-testid="`obrigacoes-vigencia-${v.inicio}-${tp}`"
            >
              {{
                t('folha.obrigacoes.parametros.faixa', {
                  de: textoLimite(v.regimes[tp].exigidaDe, false),
                  ate: textoLimite(v.regimes[tp].exigidaAte, true),
                })
              }}
              <br />
              <span class="secundario"
                >{{ v.regimes[tp].leiaute }} ·
                {{
                  v.regimes[tp].leiauteConferido
                    ? t('folha.obrigacoes.leiauteConferido')
                    : t('folha.obrigacoes.leiauteNaoConferido')
                }}</span
              >
            </td>
            <td class="secundario">{{ v.criadoPor }} · {{ instanteBr(v.criadoEm) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <section
      class="bloco"
      :aria-label="t('folha.obrigacoes.parametros.fontes')"
      data-testid="obrigacoes-fontes"
    >
      <h3>{{ t('folha.obrigacoes.parametros.fontes') }}</h3>
      <ul class="lista">
        <li v-for="tp in TIPOS_OBRIGACAO" :key="tp">
          <strong>{{ t(`folha.obrigacoes.tipos.${tp}`) }}</strong
          >: {{ apoio.fontes[tp] }}
        </li>
      </ul>
    </section>

    <SanteDialogo v-model:visivel="aberto" :titulo="t('folha.obrigacoes.parametros.nova')" largura="56rem">
      <form data-testid="obrigacoes-parametros-form" @submit.prevent="gravar">
        <ErroFolha v-if="erro" :erro="erro" :base="B" />
        <div class="campos">
          <SanteSelecao
            v-model="f.inicio"
            :rotulo="t('folha.obrigacoes.parametros.inicio')"
            :opcoes="opcoesInicio"
            busca
            data-testid="obrigacoes-param-inicio"
          />
          <SanteCampoTexto
            v-model="f.razaoSocial"
            :rotulo="t('folha.obrigacoes.parametros.razaoSocial')"
            :max-bytes="52"
            data-testid="obrigacoes-param-razao"
          />
          <SanteCampoTexto
            v-model="f.naturezaJuridica"
            :rotulo="t('folha.obrigacoes.parametros.naturezaJuridica')"
            :max-bytes="5"
            data-testid="obrigacoes-param-natureza"
          />
          <SanteCampoTexto
            v-model="f.codigoRecolhimentoSefip"
            :rotulo="t('folha.obrigacoes.parametros.codigoRecolhimentoSefip')"
            :max-bytes="3"
            data-testid="obrigacoes-param-recolhimento"
          />
          <SanteCampoTexto
            v-model="f.codigoPagamentoGps"
            :rotulo="t('folha.obrigacoes.parametros.codigoPagamentoGps')"
            :max-bytes="4"
            data-testid="obrigacoes-param-gps"
          />
        </div>
        <fieldset class="bloco">
          <legend>{{ t('folha.obrigacoes.parametros.endereco') }}</legend>
          <div class="campos">
            <SanteCampoTexto
              v-model="f.logradouro"
              :rotulo="t('folha.obrigacoes.parametros.logradouro')"
              :max-bytes="50"
              data-testid="obrigacoes-param-logradouro"
            />
            <SanteCampoTexto
              v-model="f.bairro"
              :rotulo="t('folha.obrigacoes.parametros.bairro')"
              :max-bytes="20"
              data-testid="obrigacoes-param-bairro"
            />
            <SanteCampoTexto
              v-model="f.cep"
              :rotulo="t('folha.obrigacoes.parametros.cep')"
              :max-bytes="9"
              data-testid="obrigacoes-param-cep"
            />
            <SanteCampoTexto
              v-model="f.cidade"
              :rotulo="t('folha.obrigacoes.parametros.cidade')"
              :max-bytes="20"
              data-testid="obrigacoes-param-cidade"
            />
            <SanteCampoTexto
              v-model="f.uf"
              :rotulo="t('folha.obrigacoes.parametros.uf')"
              :max-bytes="2"
              data-testid="obrigacoes-param-uf"
            />
            <SanteCampoTexto
              v-model="f.municipio"
              :rotulo="t('folha.obrigacoes.parametros.municipio')"
              :max-bytes="7"
              data-testid="obrigacoes-param-municipio"
            />
          </div>
        </fieldset>
        <fieldset class="bloco">
          <legend>{{ t('folha.obrigacoes.parametros.contato') }}</legend>
          <div class="campos">
            <SanteCampoTexto
              v-model="f.contatoNome"
              :rotulo="t('folha.obrigacoes.parametros.contatoNome')"
              :max-bytes="20"
              data-testid="obrigacoes-param-contato"
            />
            <SanteCampoTexto
              v-model="f.telefone"
              :rotulo="t('folha.obrigacoes.parametros.telefone')"
              :max-bytes="16"
              data-testid="obrigacoes-param-telefone"
            />
            <SanteCampoTexto
              v-model="f.email"
              :rotulo="t('folha.obrigacoes.parametros.email')"
              :max-bytes="60"
              data-testid="obrigacoes-param-email"
            />
          </div>
        </fieldset>
        <fieldset class="bloco" data-testid="obrigacoes-param-regimes">
          <legend>{{ t('folha.obrigacoes.parametros.regimes') }}</legend>
          <p class="secundario">{{ t('folha.obrigacoes.parametros.sugestaoAjuda') }}</p>
          <div class="acoes">
            <SanteBotao
              :rotulo="t('folha.obrigacoes.parametros.sugestao')"
              variante="secundario"
              data-testid="obrigacoes-param-sugestao"
              @acionar="usarSugestao"
            />
          </div>
          <div
            v-for="tp in TIPOS_OBRIGACAO"
            :key="tp"
            class="bloco"
            :data-testid="`obrigacoes-param-regime-${tp}`"
          >
            <h4>{{ t(`folha.obrigacoes.tipos.${tp}`) }}</h4>
            <div class="campos">
              <SanteCampoTexto
                v-model="f.regimes[tp].exigidaDe"
                :rotulo="`${t('folha.obrigacoes.parametros.exigidaDe')} (${anual(tp) ? t('folha.obrigacoes.parametros.formatoAnual') : t('folha.obrigacoes.parametros.formatoMensal')})`"
                :max-bytes="7"
                :data-testid="`obrigacoes-param-${tp}-de`"
              />
              <SanteCampoTexto
                v-model="f.regimes[tp].exigidaAte"
                :rotulo="`${t('folha.obrigacoes.parametros.exigidaAte')} (${anual(tp) ? t('folha.obrigacoes.parametros.formatoAnual') : t('folha.obrigacoes.parametros.formatoMensal')})`"
                :max-bytes="7"
                :data-testid="`obrigacoes-param-${tp}-ate`"
              />
              <SanteCampoTexto
                v-model="f.regimes[tp].leiaute"
                :rotulo="t('folha.obrigacoes.parametros.leiaute')"
                :max-bytes="20"
                :data-testid="`obrigacoes-param-${tp}-leiaute`"
              />
              <SanteSelecao
                :model-value="conferido(tp)"
                :rotulo="t('folha.obrigacoes.parametros.conferido')"
                :opcoes="opcoesConferido"
                :data-testid="`obrigacoes-param-${tp}-conferido`"
                @update:model-value="(v: string) => definirConferido(tp, v)"
              />
            </div>
          </div>
        </fieldset>
        <p v-if="tentou && !conferencia.ok" role="alert" data-testid="obrigacoes-param-invalido">
          {{ t('folha.obrigacoes.parametros.invalido', { campos: camposInvalidos }) }}
        </p>
        <div class="acoes">
          <SanteBotao
            :rotulo="t('folha.obrigacoes.gravar')"
            tipo="submit"
            :desabilitado="ocupado"
            data-testid="obrigacoes-param-gravar"
          />
          <SanteBotao
            :rotulo="t('folha.obrigacoes.fechar')"
            variante="secundario"
            @acionar="aberto = false"
          />
        </div>
      </form>
    </SanteDialogo>
  </section>
</template>

<style scoped src="../../pessoas/estilo-pessoas.css"></style>
