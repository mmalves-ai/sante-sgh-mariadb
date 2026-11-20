<script setup lang="ts">
// Prescrição do paciente (M24; ficha, seção 7): o prescritor da sessão, os atendimentos abertos com os períodos da
// regra da unidade (atual e seguinte, e se já têm prescrição ativa) e as prescrições do atendimento com a situação,
// as marcas (prova de gravação, coassinatura pendente) e as ações (abrir, renovar, copiar, nova, aplicar protocolo).
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { lerContexto, listarPrescricoes } from '../api-prescricao.js';
import AlertaAntimicrobiano from '../../qualidade/ccih/componentes/AlertaAntimicrobiano.vue';
import CabecalhoProntuario from '../componentes/CabecalhoProntuario.vue';
import { useConexao } from '../conexao.js';
import { dataHoraBr } from '../formato.js';
import DadosClinicos from '../componentes/prescricao/DadosClinicos.vue';

const props = defineProps<{ paciente: string }>();
const { t } = useI18n();
const roteador = useRouter();
const online = useConexao();
const id = computed(() => Number(props.paciente));
const contexto = useQuery({
  queryKey: computed(() => ['presc', 'contexto', id.value]),
  queryFn: () => lerContexto(id.value),
  staleTime: 0,
});
const c = computed(() => contexto.data.value);
const atendimento = ref('');
watch(
  c,
  (x) => {
    if (x && !atendimento.value) atendimento.value = String(x.atendimentos[0]?.id ?? '');
  },
  { immediate: true },
);
const at = computed(() => c.value?.atendimentos.find((a) => String(a.id) === atendimento.value) ?? null);
const opcoes = computed(() =>
  (c.value?.atendimentos ?? []).map((a) => ({
    valor: String(a.id),
    rotulo: t('pep.presc.paciente.atendimentoRotulo', {
      tipo: a.tipo,
      numero: a.numero ?? a.id,
      unidade: a.unidade ?? '',
    }),
  })),
);
const lista = useQuery({
  queryKey: computed(() => ['presc', 'lista', id.value, atendimento.value]),
  queryFn: () => listarPrescricoes(id.value, Number(atendimento.value)),
  enabled: computed(() => !!atendimento.value),
  staleTime: 0,
});
const podeCriar = computed(
  () => !!c.value?.podeCriar && !!c.value?.prescritor && !!c.value?.liberacao.ligada && online.value,
);
const base = computed(() => `/pep/paciente/${id.value}/prescricao`);
function nova(extra: Record<string, string> = {}): void {
  void roteador.push({ path: `${base.value}/nova`, query: { atendimento: atendimento.value, ...extra } });
}
</script>

<template>
  <section class="tela" aria-labelledby="presc-paciente-titulo" data-testid="tela-prescricao-paciente">
    <h1 id="presc-paciente-titulo">{{ t('pep.presc.paciente.titulo') }}</h1>
    <SanteAlerta
      v-if="!online"
      variante="alerta"
      :texto="t('pep.presc.semConexao')"
      anunciar
      data-testid="sem-conexao"
    />
    <MensagemErro v-if="contexto.isError.value" :erro="contexto.error.value" />
    <p v-else-if="!c" role="status">{{ t('pep.presc.carregando') }}</p>
    <template v-else>
      <CabecalhoProntuario :cabecalho="c.cabecalho" />
      <!-- M48 (etapa 3): o restrito sem liberação da CCIH no prazo (só alerta; nunca suspende). -->
      <AlertaAntimicrobiano v-if="at" :atendimento="at.id" />
      <SanteAlerta
        v-if="!c.liberacao.ligada"
        variante="aviso"
        :texto="c.liberacao.motivo ?? t('pep.presc.desligada')"
        data-testid="prescricao-desligada"
      />
      <SanteAlerta v-if="!c.prescritor" variante="aviso" :texto="t('pep.presc.paciente.semPrescritor')" />
      <p v-else data-testid="prescritor-sessao">
        {{
          t('pep.presc.paciente.prescritor', {
            categoria: t(`pep.presc.categorias.${c.prescritor.categoria}`),
          })
        }}
      </p>
      <SanteAlerta
        v-if="c.prescritor?.coassinatura"
        variante="info"
        :texto="t('pep.presc.paciente.coassinatura')"
      />
      <DadosClinicos v-if="c.dadosClinicos" :dados="c.dadosClinicos" />
      <p v-if="c.atendimentos.length === 0" role="status">{{ t('pep.presc.paciente.semAtendimento') }}</p>
      <template v-else>
        <SanteSelecao
          v-model="atendimento"
          :rotulo="t('pep.presc.paciente.atendimento')"
          :opcoes="opcoes"
          data-testid="escolher-atendimento"
        />
        <div v-if="at?.periodos" class="periodos" data-testid="periodos">
          <p>
            {{
              t('pep.presc.paciente.periodoAtual', {
                inicio: dataHoraBr(at.periodos.atual.inicio),
                fim: dataHoraBr(at.periodos.atual.fim),
              })
            }}
            {{ at.periodos.atual.ocupado ? t('pep.presc.paciente.ocupado') : t('pep.presc.paciente.livre') }}
          </p>
          <p>
            {{
              t('pep.presc.paciente.periodoSeguinte', {
                inicio: dataHoraBr(at.periodos.seguinte.inicio),
                fim: dataHoraBr(at.periodos.seguinte.fim),
              })
            }}
            {{
              at.periodos.seguinte.ocupado ? t('pep.presc.paciente.ocupado') : t('pep.presc.paciente.livre')
            }}
          </p>
        </div>
        <SanteAlerta v-else-if="at" variante="aviso" :texto="t('pep.presc.paciente.semRegra')" />
        <SanteAlerta
          v-if="at?.renovacaoPendente"
          variante="aviso"
          :texto="
            t('pep.presc.paciente.renovacaoPendente', {
              id: at.renovacaoPendente.prescricao,
              fim: dataHoraBr(at.renovacaoPendente.fim),
            })
          "
          anunciar
          data-testid="renovacao-pendente"
        />
        <div class="acoes">
          <SanteBotao
            v-if="podeCriar && at?.periodos"
            :rotulo="t('pep.presc.paciente.nova')"
            data-testid="nova-prescricao"
            @acionar="nova()"
          />
          <SanteBotao
            v-if="podeCriar && at?.periodos"
            :rotulo="t('pep.presc.paciente.montar')"
            variante="secundario"
            data-testid="montar-prescricao"
            @acionar="nova({ montar: '1' })"
          />
          <RouterLink :to="`${base}/futura?atendimento=${atendimento}`" data-testid="link-futura">{{
            t('pep.presc.paciente.futura')
          }}</RouterLink>
          <RouterLink
            :to="`/pep/paciente/${id}/reconciliacao?atendimento=${atendimento}`"
            data-testid="link-reconciliacao"
            >{{ t('pep.presc.paciente.reconciliacao') }}</RouterLink
          >
        </div>
        <MensagemErro v-if="lista.isError.value" :erro="lista.error.value" />
        <p v-else-if="!lista.data.value" role="status">{{ t('pep.presc.carregando') }}</p>
        <p v-else-if="lista.data.value.length === 0" role="status" data-testid="prescricoes-vazio">
          {{ t('pep.presc.paciente.vazio') }}
        </p>
        <table v-else data-testid="lista-prescricoes">
          <caption>
            {{
              t('pep.presc.paciente.lista')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('pep.presc.paciente.colunas.data') }}</th>
              <th scope="col">{{ t('pep.presc.paciente.colunas.vigencia') }}</th>
              <th scope="col">{{ t('pep.presc.paciente.colunas.situacao') }}</th>
              <th scope="col">{{ t('pep.presc.paciente.colunas.prescritor') }}</th>
              <th scope="col">{{ t('pep.presc.paciente.colunas.itens') }}</th>
              <th scope="col">{{ t('pep.presc.paciente.colunas.marcas') }}</th>
              <th scope="col">{{ t('pep.presc.paciente.colunas.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="p in lista.data.value"
              :key="p.id"
              :data-testid="`prescricao-${p.id}`"
              :class="p.situacao"
            >
              <td>
                <RouterLink
                  :to="`${base}/${p.id}`"
                  :aria-label="t('pep.presc.paciente.abrir', { data: dataHoraBr(p.dataHora) })"
                  >{{ dataHoraBr(p.dataHora) }}</RouterLink
                >
              </td>
              <td>
                {{
                  t('pep.presc.intervalo', {
                    inicio: dataHoraBr(p.vigencia.inicio),
                    fim: dataHoraBr(p.vigencia.fim),
                  })
                }}
              </td>
              <td>{{ t(`pep.presc.situacoes.${p.situacao}`) }}</td>
              <td>{{ p.prescritor }}</td>
              <td>{{ p.itens }}</td>
              <td>
                <span class="marca">{{
                  p.feitaNoNovo ? t('pep.presc.paciente.feitaAqui') : t('pep.presc.paciente.feitaFora')
                }}</span>
                <span v-if="p.coassinaturaPendente" class="marca">{{
                  t('pep.presc.paciente.coassinaturaPendente')
                }}</span>
              </td>
              <td class="acoes">
                <SanteBotao
                  v-if="podeCriar && c.podeRenovar && p.situacao !== 'suspensa'"
                  :rotulo="t('pep.presc.paciente.renovar')"
                  variante="texto"
                  :data-testid="`renovar-${p.id}`"
                  @acionar="nova({ origem: String(p.id), modo: 'renovacao', periodo: 'seguinte' })"
                />
                <SanteBotao
                  v-if="podeCriar && c.podeRenovar"
                  :rotulo="t('pep.presc.paciente.copiar')"
                  variante="texto"
                  :data-testid="`copiar-${p.id}`"
                  @acionar="nova({ origem: String(p.id), modo: 'copia' })"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </template>
    </template>
  </section>
</template>

<style scoped>
.tela {
  display: grid;
  gap: var(--sgh-espaco-3);
}
.acoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: center;
}
.acoes a {
  display: inline-flex;
  align-items: center;
  min-height: var(--sgh-alvo-minimo);
}
.periodos p {
  margin: 0;
}
table {
  border-collapse: collapse;
  width: 100%;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
td a {
  display: inline-flex;
  align-items: center;
  min-height: var(--sgh-alvo-minimo);
}
tr.suspensa td,
tr.vencida td {
  color: var(--sgh-texto-secundario);
}
.marca {
  margin-right: var(--sgh-espaco-1);
  font-size: var(--sgh-fonte-pequena);
  outline: 1px solid var(--sgh-borda-forte);
  padding: 0 var(--sgh-espaco-1);
}
</style>
