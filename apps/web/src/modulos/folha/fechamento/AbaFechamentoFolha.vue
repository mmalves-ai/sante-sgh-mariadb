<script setup lang="ts">
// Aba "Fechamento" (M53.7, etapa F6; consulta com `pessoas.folha.ler`; fechar e reabrir com `pessoas.folha.fechar`;
// ficha do M53, seções 1, 6 a 8, regras 7 e 10): os fechamentos do ano da empresa (mensais e o do 13º), a conferência
// antes de fechar (os processamentos que o período fixa, os totais, a prova da soma com as parcelas impressas e as
// pendências), fechar com a data de pagamento da folha mensal e reabrir com motivo. O servidor confere tudo de novo.
import {
  APURACOES_FOLHA,
  type ApuracaoFolha,
  type FechamentoFolha,
  esquemaReabrirFolha,
  type PendenciaFechamentoFolha,
  type ResultadoFechamentoFolha,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import { dataBr } from '../../pessoas/comum.js';
import { competenciasAte, instanteBr, reais, rotuloCompetencia } from '../comum-folha.js';
import ErroFolha from '../telas/ErroFolha.vue';
import { fecharFolha, lerFechamentos, reabrirFolha } from './api-fechamento.js';
import {
  anosAte,
  entradaFechar,
  periodoSugerido,
  prontoParaFechar,
  rotuloPeriodo,
} from './comum-fechamento.js';
import TotaisFechamento from './TotaisFechamento.vue';

const props = defineProps<{ hoje: string; empresa: number | null }>();
const { t, te } = useI18n();
const cliente = useQueryClient();
const { permissoes } = usarSessao();
const pode = computed(() => permissoes.value.has('pessoas.folha.fechar'));
const rotulo = (ap: ApuracaoFolha, p: string) =>
  rotuloPeriodo(ap, p, (ano) => t('folha.fechamento.rotuloAnual', { ano }));
const textoPendencia = (p: PendenciaFechamentoFolha) =>
  te(`folha.fechamento.pendencia.${p.codigo}`) ? t(`folha.fechamento.pendencia.${p.codigo}`) : p.mensagem;

// ── Lista do ano ──────────────────────────────────────────────────────────────────────────────────────────────
const anos = anosAte(props.hoje);
const ano = ref<string>(anos[0]!);
const opcoesAno = anos.map((a) => ({ valor: a, rotulo: a }));
const chave = computed(() => ['folha', 'fechamentos', props.empresa, ano.value]);
const lista = useQuery({
  queryKey: chave,
  queryFn: () => lerFechamentos({ empresa: props.empresa ?? undefined, ano: ano.value }),
  enabled: computed(() => props.empresa !== null),
});
const itens = computed(() => lista.data.value?.itens ?? []);
const atualizar = () => cliente.invalidateQueries({ queryKey: ['folha', 'fechamentos'] });

// ── Fechar ────────────────────────────────────────────────────────────────────────────────────────────────────
const apuracao = ref<ApuracaoFolha>('mensal');
const opcoesApuracao = APURACOES_FOLHA.map((a) => ({
  valor: a,
  rotulo: t(`folha.fechamento.apuracoes.${a}`),
}));
const periodo = ref<string>(periodoSugerido('mensal', props.hoje));
watch(apuracao, (a) => (periodo.value = periodoSugerido(a, props.hoje)));
const opcoesPeriodo = computed(() =>
  apuracao.value === 'mensal'
    ? competenciasAte(props.hoje, 24).map((c) => ({ valor: c, rotulo: rotuloCompetencia(c) }))
    : anos.map((a) => ({ valor: a, rotulo: a })),
);
const pagamento = ref<string | null>(null);
const previaEntrada = computed(() =>
  entradaFechar(props.empresa, apuracao.value, periodo.value, pagamento.value, true),
);
const resultado = ref<ResultadoFechamentoFolha | null>(null);
const resultadoVisivel = ref(false);
const aviso = ref<string | null>(null);
const erro = ref<unknown>(null);
const erroResultado = ref<unknown>(null);
const ocupado = ref(false);
async function previa(): Promise<void> {
  if (!previaEntrada.value) return;
  erro.value = null;
  aviso.value = null;
  ocupado.value = true;
  try {
    resultado.value = await fecharFolha(previaEntrada.value);
    erroResultado.value = null;
    resultadoVisivel.value = true;
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
async function fechar(): Promise<void> {
  if (!previaEntrada.value || !prontoParaFechar(resultado.value)) return;
  erroResultado.value = null;
  ocupado.value = true;
  try {
    const r = await fecharFolha({ ...previaEntrada.value, simular: false });
    resultado.value = r;
    if (r.fechamento) {
      aviso.value = t('folha.fechamento.fechado', {
        periodo: rotulo(r.fechamento.apuracao, r.fechamento.periodo),
        n: r.fechamento.numero,
      });
      resultadoVisivel.value = false;
    }
    await atualizar();
  } catch (x) {
    erroResultado.value = x;
  } finally {
    ocupado.value = false;
  }
}

// ── Detalhe e reabertura ──────────────────────────────────────────────────────────────────────────────────────
const detalhe = ref<FechamentoFolha | null>(null);
const detalheVisivel = ref(false);
function abrirDetalhe(f: FechamentoFolha): void {
  detalhe.value = f;
  detalheVisivel.value = true;
}
const reabrindo = ref<FechamentoFolha | null>(null);
const reaberturaVisivel = ref(false);
const motivo = ref('');
const erroReabertura = ref<unknown>(null);
function abrirReabertura(f: FechamentoFolha): void {
  reabrindo.value = f;
  motivo.value = '';
  erroReabertura.value = null;
  reaberturaVisivel.value = true;
}
const reaberturaEntrada = computed(() =>
  reabrindo.value
    ? esquemaReabrirFolha.safeParse({ versao: reabrindo.value.versao, motivo: motivo.value })
    : null,
);
async function reabrir(): Promise<void> {
  const f = reabrindo.value;
  const e = reaberturaEntrada.value;
  if (!f || !e?.success) return;
  erroReabertura.value = null;
  ocupado.value = true;
  try {
    await reabrirFolha(f.id, e.data);
    aviso.value = t('folha.fechamento.reaberto', { periodo: rotulo(f.apuracao, f.periodo) });
    reaberturaVisivel.value = false;
    await atualizar();
  } catch (x) {
    erroReabertura.value = x;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="bloco" :aria-label="t('folha.fechamento.titulo')" data-testid="folha-fechamento">
    <h2>{{ t('folha.fechamento.titulo') }}</h2>
    <p class="secundario">{{ t('folha.fechamento.ajuda') }}</p>
    <p v-if="empresa === null" role="status" data-testid="folha-fechamento-escolha-empresa">
      {{ t('folha.fechamento.escolhaEmpresa') }}
    </p>
    <template v-else>
      <SanteAlerta
        v-if="aviso"
        :texto="aviso"
        variante="info"
        anunciar
        data-testid="folha-fechamento-aviso"
      />
      <SanteAlerta
        v-if="!pode"
        :texto="t('folha.fechamento.soConsulta')"
        variante="info"
        data-testid="folha-fechamento-so-consulta"
      />

      <form v-if="pode" class="bloco" data-testid="folha-fechamento-form" @submit.prevent="previa">
        <ErroFolha v-if="erro" :erro="erro" />
        <div class="campos">
          <SanteSelecao
            v-model="apuracao"
            :rotulo="t('folha.fechamento.apuracao')"
            :opcoes="opcoesApuracao"
            data-testid="folha-fechamento-apuracao"
          />
          <SanteSelecao
            v-model="periodo"
            :rotulo="apuracao === 'mensal' ? t('folha.fechamento.periodo') : t('folha.fechamento.ano13')"
            :opcoes="opcoesPeriodo"
            busca
            data-testid="folha-fechamento-periodo"
          />
          <SanteData
            v-if="apuracao === 'mensal'"
            v-model="pagamento"
            :rotulo="t('folha.fechamento.pagamento')"
            editavel
            data-testid="folha-fechamento-pagamento"
          />
        </div>
        <p v-if="apuracao === 'mensal'" class="secundario">{{ t('folha.fechamento.pagamentoAjuda') }}</p>
        <SanteBotao
          :rotulo="t('folha.fechamento.previa')"
          tipo="submit"
          :desabilitado="ocupado || !previaEntrada"
          data-testid="folha-fechamento-previa"
        />
      </form>

      <h3>{{ t('folha.fechamento.lista') }}</h3>
      <div class="campos">
        <SanteSelecao
          v-model="ano"
          :rotulo="t('folha.fechamento.ano')"
          :opcoes="opcoesAno"
          data-testid="folha-fechamento-ano"
        />
      </div>
      <ErroFolha v-if="lista.isError.value" :erro="lista.error.value" />
      <p v-else-if="!lista.data.value" role="status">{{ t('folha.carregando') }}</p>
      <p v-else-if="itens.length === 0" data-testid="folha-fechamento-vazio">
        {{ t('folha.fechamento.nenhum') }}
      </p>
      <div v-else class="rolagem" tabindex="0" role="region" :aria-label="t('folha.fechamento.lista')">
        <table class="tabela" data-testid="folha-fechamento-lista">
          <thead>
            <tr>
              <th scope="col">{{ t('folha.fechamento.periodo') }}</th>
              <th scope="col">{{ t('folha.fechamento.numero') }}</th>
              <th scope="col">{{ t('folha.situacao') }}</th>
              <th scope="col">{{ t('folha.fechamento.pagamento') }}</th>
              <th scope="col">{{ t('folha.fechamento.processos') }}</th>
              <th scope="col">{{ t('folha.fechamento.liquido') }}</th>
              <th scope="col">{{ t('folha.fechamento.fechadoPor') }}</th>
              <th scope="col">{{ t('folha.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="f in itens" :key="f.id" :data-testid="`folha-fechamento-linha-${f.id}`">
              <th scope="row">{{ rotulo(f.apuracao, f.periodo) }}</th>
              <td>{{ f.numero }}</td>
              <td :data-testid="`folha-fechamento-situacao-${f.id}`">
                {{ t(`folha.fechamento.situacoes.${f.situacao}`) }}
              </td>
              <td>{{ f.pagamento ? dataBr(f.pagamento) : '—' }}</td>
              <td>{{ f.totais.processos }}</td>
              <td>{{ reais(f.totais.liquido) }}</td>
              <td>{{ t('folha.fechamento.porEm', { por: f.fechadoPor, em: instanteBr(f.fechadoEm) }) }}</td>
              <td class="acoes">
                <SanteBotao
                  :rotulo="t('folha.fechamento.detalhe')"
                  variante="secundario"
                  :data-testid="`folha-fechamento-detalhe-${f.id}`"
                  @acionar="abrirDetalhe(f)"
                />
                <SanteBotao
                  v-if="pode && f.situacao === 'fechada'"
                  :rotulo="t('folha.fechamento.reabrir')"
                  variante="secundario"
                  :data-testid="`folha-fechamento-reabrir-${f.id}`"
                  @acionar="abrirReabertura(f)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="lista.data.value?.limitado" class="secundario">{{ t('folha.fechamento.limitado') }}</p>
    </template>

    <!-- Conferência antes de fechar -->
    <SanteDialogo
      v-model:visivel="resultadoVisivel"
      :titulo="t('folha.fechamento.previaTitulo')"
      largura="60rem"
    >
      <div v-if="resultado" data-testid="folha-fechamento-resultado">
        <ErroFolha v-if="erroResultado" :erro="erroResultado" />
        <template v-if="resultado.pendencias.length">
          <p role="alert">{{ t('folha.fechamento.pendencias') }}</p>
          <ul class="lista" data-testid="folha-fechamento-pendencias">
            <li
              v-for="(p, i) in resultado.pendencias"
              :key="i"
              :data-testid="`folha-fechamento-pendencia-${p.codigo}`"
            >
              {{ textoPendencia(p) }}<span v-if="p.processo"> ({{ p.processo }})</span>
            </li>
          </ul>
        </template>
        <p v-else class="secundario" data-testid="folha-fechamento-sem-pendencias">
          {{ t('folha.fechamento.semPendencias') }}
        </p>
        <TotaisFechamento
          :processos="resultado.processos"
          :totais="resultado.totais"
          :conferencia="resultado.conferencia"
        />
        <div class="acoes">
          <SanteBotao
            v-if="prontoParaFechar(resultado)"
            :rotulo="t('folha.fechamento.fechar')"
            :desabilitado="ocupado"
            data-testid="folha-fechamento-fechar"
            @acionar="fechar"
          />
          <SanteBotao
            :rotulo="t('folha.fechar')"
            variante="secundario"
            data-testid="folha-fechamento-resultado-fechar"
            @acionar="resultadoVisivel = false"
          />
        </div>
      </div>
    </SanteDialogo>

    <!-- Detalhe -->
    <SanteDialogo
      v-model:visivel="detalheVisivel"
      :titulo="
        detalhe
          ? t('folha.fechamento.detalheTitulo', {
              periodo: rotulo(detalhe.apuracao, detalhe.periodo),
              n: detalhe.numero,
            })
          : ''
      "
      largura="60rem"
    >
      <div v-if="detalhe" data-testid="folha-fechamento-detalhe">
        <p>
          <strong>{{ t(`folha.fechamento.situacoes.${detalhe.situacao}`) }}</strong>
          · {{ t('folha.fechamento.porEm', { por: detalhe.fechadoPor, em: instanteBr(detalhe.fechadoEm) }) }}
          <span v-if="detalhe.pagamento">
            · {{ t('folha.fechamento.pagamento') }}: {{ dataBr(detalhe.pagamento) }}</span
          >
        </p>
        <p v-if="detalhe.reabertoPor && detalhe.reabertoEm" class="secundario">
          {{
            t('folha.fechamento.reabertoPor', {
              por: detalhe.reabertoPor,
              em: instanteBr(detalhe.reabertoEm),
              motivo: detalhe.motivo ?? '',
            })
          }}
        </p>
        <TotaisFechamento :processos="detalhe.processos" :totais="detalhe.totais" :conferencia="null" />
        <p class="secundario" data-testid="folha-fechamento-resumo">
          {{ t('folha.fechamento.resumo') }}: <code>{{ detalhe.resumo }}</code>
        </p>
        <p v-if="detalhe.processos.some((p) => p.liquido === null)" class="secundario">
          {{ t('folha.fechamento.semValorAjuda') }}
        </p>
        <div class="acoes">
          <SanteBotao
            :rotulo="t('folha.fechar')"
            variante="secundario"
            data-testid="folha-fechamento-detalhe-fechar"
            @acionar="detalheVisivel = false"
          />
        </div>
      </div>
    </SanteDialogo>

    <!-- Reabertura -->
    <SanteDialogo
      v-model:visivel="reaberturaVisivel"
      :titulo="
        reabrindo
          ? t('folha.fechamento.reabertura.titulo', {
              periodo: rotulo(reabrindo.apuracao, reabrindo.periodo),
            })
          : ''
      "
    >
      <form data-testid="folha-fechamento-reabertura-form" @submit.prevent="reabrir">
        <p class="secundario">{{ t('folha.fechamento.reabertura.ajuda') }}</p>
        <ErroFolha v-if="erroReabertura" :erro="erroReabertura" />
        <SanteCampoTexto
          v-model="motivo"
          :rotulo="t('folha.fechamento.reabertura.motivo')"
          :max-bytes="200"
          multilinha
          data-testid="folha-fechamento-reabertura-motivo"
        />
        <div class="acoes">
          <SanteBotao
            :rotulo="t('folha.fechamento.reabrir')"
            tipo="submit"
            :desabilitado="ocupado || !reaberturaEntrada?.success"
            data-testid="folha-fechamento-reabertura-confirmar"
          />
          <SanteBotao
            :rotulo="t('folha.cancelar')"
            variante="secundario"
            @acionar="reaberturaVisivel = false"
          />
        </div>
      </form>
    </SanteDialogo>
  </section>
</template>

<style scoped src="../../pessoas/estilo-pessoas.css"></style>
