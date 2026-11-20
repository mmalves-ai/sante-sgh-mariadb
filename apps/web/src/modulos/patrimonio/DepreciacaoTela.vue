<script setup lang="ts">
// Depreciação (M54, etapa 6; item `Controladoria > Patrimônio > Depreciação`; `patrimonio.depreciacao.ler`): a
// competência da empresa com a prévia (ainda não calculada) ou as cotas gravadas, o total com as parcelas por grupo e
// por centro de custo (a conta impressa), os bens sem cota com o motivo, os parâmetros da empresa (com o caminho para
// eles) e o que impede calcular. Calcular e gravar (`patrimonio.depreciacao.calcular`) pede confirmação: a cota é
// imutável e vira fato contábil (D-SEQ-546, D-FATO-DEPREC-546). O servidor confere tudo de novo na transação.
import type { ParcelaDepreciacao } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../casca/MensagemErro.vue';
import SenhaConfirmacao from '../administracao/componentes/SenhaConfirmacao.vue';
import {
  calcularDepreciacao,
  estornarDepreciacao,
  lerApoioPatrimonio,
  lerDepreciacao,
} from './api-patrimonio.js';
import {
  competenciaAnterior,
  competenciasAte,
  conferenciaDasParcelas,
  hojeLocal,
  instante,
  reais,
  rotuloCompetencia,
} from './comum-patrimonio.js';
import ErroPatrimonio from './ErroPatrimonio.vue';

const props = defineProps<{ hoje?: string }>();
const { t } = useI18n();
const cliente = useQueryClient();
const hoje = computed(() => props.hoje ?? hojeLocal());

const apoio = useQuery({
  queryKey: ['patrimonio', 'apoio', 'depreciacao'],
  queryFn: () => lerApoioPatrimonio('depreciacao'),
});
const a = computed(() => apoio.data.value ?? null);
const empresa = ref<number | null>(null);
watch(
  a,
  (x) => {
    if (x && (empresa.value === null || !x.empresas.some((e) => e.id === empresa.value)))
      empresa.value = x.empresas[0]?.id ?? null;
  },
  { immediate: true },
);
const opcoesEmpresa = computed(() =>
  (a.value?.empresas ?? []).map((e) => ({ valor: e.id as number | null, rotulo: e.nome })),
);
/** A competência a calcular é, em geral, a do mês que acabou. */
const competencia = ref(competenciaAnterior(hoje.value.slice(0, 7)));
const competencias = computed(() => competenciasAte(hoje.value, 36));

const consulta = useQuery({
  queryKey: computed(() => ['patrimonio', 'depreciacao', empresa.value, competencia.value]),
  queryFn: () => lerDepreciacao(empresa.value!, competencia.value),
  enabled: computed(() => empresa.value !== null),
});
const d = computed(() => consulta.data.value ?? null);
const conferencia = (parcelas: readonly ParcelaDepreciacao[]) =>
  conferenciaDasParcelas(d.value?.totalCent ?? 0, parcelas);

const ocupado = ref(false);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
async function calcular() {
  if (empresa.value === null) return;
  ocupado.value = true;
  erro.value = null;
  mensagem.value = null;
  try {
    const r = await calcularDepreciacao(empresa.value, competencia.value);
    cliente.setQueryData(['patrimonio', 'depreciacao', empresa.value, competencia.value], r);
    mensagem.value = t('patrimonio.depreciacao.feito', {
      competencia: rotuloCompetencia(r.competencia),
      total: reais(r.totalCent),
    });
    await cliente.invalidateQueries({ queryKey: ['patrimonio', 'bens'] });
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}

// ── Estorno do cálculo (W0-08) ──────────────────────────────────────────────────────────────────────────────────────
const estornando = ref(false);
const motivoEstorno = ref('');
const senha = ref('');
const estornoPronto = computed(() => motivoEstorno.value.trim().length >= 5 && senha.value !== '');
watch([empresa, competencia], () => {
  estornando.value = false;
  motivoEstorno.value = '';
});
async function estornar() {
  if (empresa.value === null || !estornoPronto.value) return;
  ocupado.value = true;
  erro.value = null;
  mensagem.value = null;
  try {
    const r = await estornarDepreciacao({
      empresa: empresa.value,
      competencia: competencia.value,
      motivo: motivoEstorno.value.trim(),
      senha: senha.value,
    });
    cliente.setQueryData(['patrimonio', 'depreciacao', empresa.value, competencia.value], r);
    mensagem.value = t('patrimonio.depreciacao.estornoFeito', {
      competencia: rotuloCompetencia(r.competencia),
    });
    estornando.value = false;
    motivoEstorno.value = '';
    await cliente.invalidateQueries({ queryKey: ['patrimonio', 'bens'] });
  } catch (e) {
    erro.value = e;
  } finally {
    senha.value = '';
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="tela-patrimonio" aria-labelledby="deprec-titulo" data-testid="tela-depreciacao">
    <h1 id="deprec-titulo">{{ t('patrimonio.depreciacao.titulo') }}</h1>
    <p>{{ t('patrimonio.depreciacao.descricao') }}</p>
    <MensagemErro v-if="apoio.isError.value" :erro="apoio.error.value" />
    <p v-else-if="!a" role="status">{{ t('patrimonio.carregando') }}</p>
    <template v-else>
      <SanteAlerta
        v-if="!a.liberacao.ligada"
        :texto="t('patrimonio.desligado')"
        variante="info"
        data-testid="patrimonio-desligado"
      />
      <div class="campos">
        <SanteSelecao
          v-model="empresa"
          :rotulo="t('patrimonio.empresa')"
          :opcoes="opcoesEmpresa"
          busca
          data-testid="deprec-empresa"
        />
        <SanteSelecao
          v-model="competencia"
          :rotulo="t('patrimonio.competencia')"
          :opcoes="competencias.map((c) => ({ valor: c, rotulo: rotuloCompetencia(c) }))"
          busca
          data-testid="deprec-competencia"
        />
      </div>
      <p v-if="mensagem" role="status" class="ok" data-testid="deprec-mensagem">{{ mensagem }}</p>
      <ErroPatrimonio v-if="erro" :erro="erro" />
      <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
      <p v-else-if="!d" role="status">{{ t('patrimonio.carregando') }}</p>
      <template v-else>
        <section class="bloco" aria-labelledby="deprec-param-titulo" data-testid="deprec-parametros">
          <h2 id="deprec-param-titulo">{{ t('patrimonio.depreciacao.parametros') }}</h2>
          <dl class="dados">
            <dt>{{ t('patrimonio.depreciacao.depreciar') }}</dt>
            <dd>{{ d.parametros.depreciar ? t('patrimonio.sim') : t('patrimonio.nao') }}</dd>
            <dt>{{ t('patrimonio.depreciacao.aplicarCoeficiente') }}</dt>
            <dd>{{ d.parametros.aplicarCoeficiente ? t('patrimonio.sim') : t('patrimonio.nao') }}</dd>
            <dt>{{ t('patrimonio.depreciacao.considerarResidual') }}</dt>
            <dd>{{ d.parametros.considerarResidual ? t('patrimonio.sim') : t('patrimonio.nao') }}</dd>
          </dl>
          <RouterLink to="/patrimonio/parametros" data-testid="deprec-ir-parametros">{{
            t('patrimonio.depreciacao.irParametros')
          }}</RouterLink>
        </section>

        <p data-testid="deprec-situacao">
          <template v-if="d.calculo"
            >{{
              t('patrimonio.depreciacao.calculada', {
                por: d.calculo.calculadoPor,
                em: instante(d.calculo.calculadoEm),
                bens: d.calculo.bens,
                ignorados: d.calculo.ignorados,
              })
            }}<span v-if="d.calculo.rodada > 1" class="secundario">
              ({{ t('patrimonio.depreciacao.rodada', { n: d.calculo.rodada }) }})</span
            ></template
          >
          <template v-else>{{ t('patrimonio.depreciacao.previa') }}</template>
        </p>

        <section
          v-if="d.impedimentos.length > 0"
          class="bloco"
          aria-labelledby="deprec-imp-titulo"
          data-testid="deprec-impedimentos"
        >
          <h2 id="deprec-imp-titulo">{{ t('patrimonio.depreciacao.impedimentos') }}</h2>
          <ul>
            <li v-for="(i, n) in d.impedimentos" :key="n">{{ i }}</li>
          </ul>
        </section>

        <section class="bloco" aria-labelledby="deprec-total-titulo" data-testid="deprec-total">
          <h2 id="deprec-total-titulo">{{ t('patrimonio.depreciacao.total') }}: {{ reais(d.totalCent) }}</h2>
          <template v-for="lado in ['porGrupo', 'porCentro'] as const" :key="lado">
            <h3>{{ t(`patrimonio.depreciacao.${lado}`) }}</h3>
            <div class="rolagem">
              <table class="tabela" :data-testid="`deprec-${lado}`">
                <thead>
                  <tr>
                    <th scope="col">
                      {{ lado === 'porGrupo' ? t('patrimonio.bens.grupo') : t('patrimonio.setor') }}
                    </th>
                    <th scope="col">{{ t('patrimonio.depreciacao.bens') }}</th>
                    <th scope="col">{{ t('patrimonio.depreciacao.cota') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="p in d[lado]" :key="p.chave">
                    <td>{{ p.rotulo }}</td>
                    <td>{{ p.bens }}</td>
                    <td>{{ reais(p.valorCent) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p class="secundario" :data-testid="`deprec-conferencia-${lado}`">
              {{ conferencia(d[lado]).texto }}
            </p>
            <p v-if="!conferencia(d[lado]).fecha" class="erro">
              {{ t('patrimonio.depreciacao.conferenciaNaoFecha') }}
            </p>
          </template>
        </section>

        <section class="bloco" aria-labelledby="deprec-cotas-titulo">
          <h2 id="deprec-cotas-titulo">{{ t('patrimonio.depreciacao.cotas') }} ({{ d.cotas.length }})</h2>
          <p v-if="d.cotas.length === 0" class="secundario">{{ t('patrimonio.nenhum') }}</p>
          <div v-else class="rolagem">
            <table class="tabela" data-testid="deprec-cotas">
              <thead>
                <tr>
                  <th scope="col">{{ t('patrimonio.bens.plaqueta') }}</th>
                  <th scope="col">{{ t('patrimonio.bens.descricaoBem') }}</th>
                  <th scope="col">{{ t('patrimonio.depreciacao.base') }}</th>
                  <th scope="col">{{ t('patrimonio.depreciacao.meses') }}</th>
                  <th scope="col">{{ t('patrimonio.depreciacao.acumuladaAntes') }}</th>
                  <th scope="col">{{ t('patrimonio.depreciacao.cota') }}</th>
                  <th scope="col">{{ t('patrimonio.depreciacao.acumuladaDepois') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="c in d.cotas" :key="c.bem" :data-testid="`cota-${c.bem}`">
                  <td>{{ c.plaqueta }}</td>
                  <td>
                    {{ c.descricao }}
                    <span v-if="c.recuperaMeses" class="secundario"
                      >({{ t('patrimonio.depreciacao.recupera') }})</span
                    >
                    <span v-if="c.ultima" class="secundario">({{ t('patrimonio.depreciacao.ultima') }})</span>
                  </td>
                  <td>{{ reais(c.baseCent) }}</td>
                  <td>{{ c.mesesDecorridos }} / {{ c.vidaUtilMeses }}</td>
                  <td>{{ reais(c.acumuladaAntesCent) }}</td>
                  <td>{{ reais(c.valorCent) }}</td>
                  <td>{{ reais(c.acumuladaDepoisCent) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <details v-if="d.semCota.length > 0" data-testid="deprec-sem-cota">
            <summary>{{ t('patrimonio.depreciacao.semCota', { n: d.semCota.length }) }}</summary>
            <ul>
              <li v-for="s in d.semCota" :key="s.bem">
                {{ s.plaqueta }}: {{ t(`patrimonio.motivosSemCota.${s.motivo}`) }}
              </li>
            </ul>
          </details>
        </section>

        <details v-if="d.estornos.length > 0" class="bloco" data-testid="deprec-estornos">
          <summary>{{ t('patrimonio.depreciacao.estornos', { n: d.estornos.length }) }}</summary>
          <ul>
            <li v-for="x in d.estornos" :key="x.id">
              {{
                t('patrimonio.depreciacao.estornoLinha', {
                  por: x.estornadoPor,
                  em: instante(x.estornadoEm),
                  bens: x.bens,
                  total: reais(x.totalCent),
                })
              }}
              — {{ x.motivo }}
            </li>
          </ul>
        </details>

        <div v-if="d.calculo && d.estornavel && a.acoes.calcular && !estornando" class="acoes">
          <SanteBotao
            variante="secundario"
            :rotulo="t('patrimonio.depreciacao.estornar')"
            data-testid="deprec-estornar"
            @acionar="estornando = true"
          />
        </div>
        <form
          v-if="d.calculo && estornando"
          class="bloco"
          aria-labelledby="deprec-estorno-titulo"
          data-testid="deprec-estorno"
          @submit.prevent
        >
          <h2 id="deprec-estorno-titulo">{{ t('patrimonio.depreciacao.estornoTitulo') }}</h2>
          <p class="secundario">{{ t('patrimonio.depreciacao.estornoAjuda') }}</p>
          <SanteCampoTexto
            v-model="motivoEstorno"
            :rotulo="t('patrimonio.motivo')"
            :max-bytes="400"
            multilinha
            obrigatorio
            data-testid="deprec-estorno-motivo"
          />
          <SenhaConfirmacao v-model="senha" testid="deprec-estorno-senha" />
          <div class="acoes">
            <SanteBotao
              variante="secundario"
              :rotulo="t('patrimonio.cancelar')"
              @acionar="estornando = false"
            />
            <SanteBotao
              variante="destrutivo"
              :rotulo="t('patrimonio.depreciacao.estornar')"
              :confirmacao="
                t('patrimonio.depreciacao.confirmarEstorno', {
                  competencia: rotuloCompetencia(d.competencia),
                  total: reais(d.totalCent),
                })
              "
              :desabilitado="ocupado || !estornoPronto"
              data-testid="deprec-estorno-confirmar"
              @acionar="estornar"
            />
          </div>
        </form>

        <div v-if="!d.calculo && a.acoes.calcular" class="acoes">
          <SanteBotao
            variante="destrutivo"
            :rotulo="t('patrimonio.depreciacao.calcular')"
            :confirmacao="t('patrimonio.depreciacao.confirmarCalculo')"
            :desabilitado="ocupado || d.impedimentos.length > 0"
            data-testid="deprec-calcular"
            @acionar="calcular"
          />
        </div>
      </template>
    </template>
  </section>
</template>

<style scoped src="./estilo-patrimonio.css"></style>
