<script setup lang="ts">
// Ciclo de esterilização pelos testes dos indicadores, liberação e rejeição no reprocessamento (CME; F7, 04-CME linha
// 116; RDC 15/2012). O desfecho do ciclo sai dos testes gravados (o servidor decide); a tela só registra o teste e pede
// o encerramento. A rejeição do ciclo põe em recolhimento os pacotes já distribuídos, recolhidos um a um.
import { SanteSelecao } from '@sgh/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  encerrarCiclo,
  lerCicloComTestes,
  lerPainelCiclos,
  recolher,
  registrarTeste,
  rejeitar,
  RESULTADOS_TESTE,
} from '../api-cme-ciclo.js';
import ErroCirurgia from '../componentes/ErroCirurgia.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const CHAVE = ['cirurgia', 'cme', 'ciclos'];
const painel = useQuery({ queryKey: CHAVE, queryFn: lerPainelCiclos });
const cicloId = ref<number | null>(null);
const ciclo = useQuery({
  queryKey: computed(() => [...CHAVE, cicloId.value]),
  queryFn: () => lerCicloComTestes(cicloId.value!),
  enabled: computed(() => cicloId.value !== null),
});
const aviso = ref('');
const erro = ref<unknown>(null);

const acao = useMutation({
  mutationFn: (fn: () => Promise<unknown>) => fn(),
  onSuccess: () => {
    erro.value = null;
    aviso.value = t('cirurgia.cmeCiclo.gravado');
    void cliente.invalidateQueries({ queryKey: CHAVE });
  },
  onError: (e) => {
    erro.value = e;
    aviso.value = '';
  },
});

const vazio = computed(() => ({ valor: null, rotulo: t('cirurgia.cmeCiclo.nenhum') }));
const situacao = (s: string) => t(`cirurgia.cmeCiclo.situacoes.${s}`);
const opcCiclos = computed(() => [
  vazio.value,
  ...(painel.data.value?.ciclos ?? []).map((c) => ({
    valor: c.id,
    rotulo: `${c.numero} · ${c.lote} · ${situacao(c.situacao)}`,
  })),
]);
const opcTipos = computed(() => [
  vazio.value,
  ...(painel.data.value?.tipos ?? []).map((x) => ({
    valor: x.id,
    rotulo: `${x.descricao} (${t(`cirurgia.cmeCiclo.categorias.${x.categoria}`)})`,
  })),
]);
const opcResultados = computed(() =>
  RESULTADOS_TESTE.map((v) => ({ valor: v, rotulo: t(`cirurgia.cmeCiclo.resultados.${v}`) })),
);
const opcMotivos = computed(() => [
  vazio.value,
  ...(painel.data.value?.motivos ?? []).map((x) => ({ valor: x.id, rotulo: x.descricao })),
]);
const opcFases = computed(() => [
  vazio.value,
  ...(painel.data.value?.fases ?? []).map((x) => ({ valor: x.id, rotulo: x.descricao })),
]);
const opcObjetos = computed(() =>
  (['pacote', 'ciclo'] as const).map((v) => ({ valor: v, rotulo: t(`cirurgia.cmeCiclo.objetos.${v}`) })),
);
const opcPacotes = computed(() => [
  vazio.value,
  ...(ciclo.data.value?.pacotes ?? []).map((p) => ({
    valor: p.id,
    rotulo: `${p.etiqueta} · ${situacao(p.situacao)}`,
  })),
]);
const tipoEscolhido = computed(() => painel.data.value?.tipos.find((x) => x.id === teste.tipo) ?? null);

const teste = reactive({
  tipo: null as number | null,
  resultado: 'aprovado' as (typeof RESULTADOS_TESTE)[number],
  lote: '',
  validade: '',
  incubacaoInicio: '',
  leitura: '',
  controlePositivoOk: false,
  valorMedido: '',
  observacao: '',
});
const rej = reactive({
  objeto: 'pacote' as 'pacote' | 'ciclo',
  pacote: null as number | null,
  motivo: null as number | null,
  fase: null as number | null,
  retorna: true,
  faseRetorno: null as number | null,
  descricao: '',
});
const txt = (v: string) => v.trim() || null;

const salvarTeste = () => {
  if (cicloId.value === null || teste.tipo === null) return;
  const id = cicloId.value;
  acao.mutate(() =>
    registrarTeste(id, {
      tipo: teste.tipo!,
      resultado: teste.resultado,
      lote: txt(teste.lote),
      validade: txt(teste.validade),
      incubacaoInicio: txt(teste.incubacaoInicio),
      leitura: txt(teste.leitura),
      controlePositivoOk: tipoEscolhido.value?.exigeControle ? teste.controlePositivoOk : null,
      valorMedido: txt(teste.valorMedido),
      observacao: txt(teste.observacao),
    }),
  );
};
const encerrar = () => {
  const c = ciclo.data.value;
  if (c) acao.mutate(() => encerrarCiclo(c.id, c.versao, null));
};
const salvarRejeicao = () => {
  if (cicloId.value === null || rej.motivo === null || rej.fase === null) return;
  const id = cicloId.value;
  acao.mutate(() =>
    rejeitar({
      objeto: rej.objeto,
      pacote: rej.objeto === 'pacote' ? rej.pacote : null,
      ciclo: rej.objeto === 'ciclo' ? id : null,
      motivo: rej.motivo!,
      fase: rej.fase!,
      descricao: txt(rej.descricao),
      retorna: rej.retorna,
      faseRetorno: rej.retorna ? rej.faseRetorno : null,
    }),
  );
};
const recolherPacote = (rejeicao: number, pacote: number) => acao.mutate(() => recolher(rejeicao, pacote));
const doCiclo = (r: { ciclo: number | null; pacote: number | null }) =>
  r.ciclo === cicloId.value || (ciclo.data.value?.pacotes ?? []).some((p) => p.id === r.pacote);
const distribuidos = computed(() =>
  (ciclo.data.value?.pacotes ?? []).filter((p) => p.situacao === 'distribuido'),
);
const podeTestar = computed(() => ['em_andamento', 'concluido'].includes(ciclo.data.value?.situacao ?? ''));
</script>

<template>
  <section class="tela-agenda" aria-labelledby="cme-ciclo-titulo" data-testid="tela-cme-ciclos">
    <h1 id="cme-ciclo-titulo">{{ t('cirurgia.cmeCiclo.titulo') }}</h1>
    <p>{{ t('cirurgia.cmeCiclo.texto') }}</p>
    <ErroCirurgia v-if="painel.isError.value" :erro="painel.error.value" />
    <ErroCirurgia v-if="ciclo.isError.value" :erro="ciclo.error.value" />
    <ErroCirurgia v-if="erro" :erro="erro" />
    <p v-if="aviso" role="status" data-testid="cme-ciclo-aviso">{{ aviso }}</p>

    <p v-if="!painel.data.value" role="status">{{ t('cirurgia.carregando') }}</p>
    <template v-else>
      <div class="filtros">
        <SanteSelecao
          v-model="cicloId"
          :rotulo="t('cirurgia.cmeCiclo.ciclo')"
          :opcoes="opcCiclos"
          data-testid="cme-ciclo-escolha"
        />
      </div>
      <p v-if="cicloId === null">{{ t('cirurgia.cmeCiclo.escolhaCiclo') }}</p>

      <template v-if="ciclo.data.value">
        <dl class="filtros" data-testid="cme-ciclo-resumo">
          <dt>{{ t('cirurgia.cmeCiclo.lote') }}</dt>
          <dd>{{ ciclo.data.value.lote }}</dd>
          <dt>{{ t('cirurgia.cmeCiclo.equipamento') }}</dt>
          <dd>{{ ciclo.data.value.equipamento }}</dd>
          <dt>{{ t('cirurgia.cmeCiclo.metodo') }}</dt>
          <dd>{{ ciclo.data.value.metodo }}</dd>
          <dt>{{ t('cirurgia.cmeCiclo.situacaoCiclo') }}</dt>
          <dd data-testid="cme-ciclo-situacao">{{ situacao(ciclo.data.value.situacao) }}</dd>
        </dl>
        <p v-if="ciclo.data.value.implante" role="note">{{ t('cirurgia.cmeCiclo.implante') }}</p>

        <h2>{{ t('cirurgia.cmeCiclo.indicadores') }}</h2>
        <ul data-testid="cme-ciclo-indicadores">
          <li
            v-for="k in ['fisico', 'quimico', 'biologico'] as const"
            :key="k"
            :data-testid="`cme-indicador-${k}`"
          >
            {{ t(`cirurgia.cmeCiclo.categorias.${k}`) }}:
            {{ t(`cirurgia.cmeCiclo.indicador.${ciclo.data.value.indicadores[k]}`) }}
          </li>
        </ul>

        <h2>{{ t('cirurgia.cmeCiclo.testes') }}</h2>
        <p v-if="!ciclo.data.value.testes.length">{{ t('cirurgia.cmeCiclo.semTestes') }}</p>
        <table v-else data-testid="cme-ciclo-testes">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">{{ t('cirurgia.cmeCiclo.tipo') }}</th>
              <th scope="col">{{ t('cirurgia.cmeCiclo.resultado') }}</th>
              <th scope="col">{{ t('cirurgia.cmeCiclo.loteIndicador') }}</th>
              <th scope="col">{{ t('cirurgia.cmeCiclo.leitura') }}</th>
              <th scope="col">{{ t('cirurgia.cmeCiclo.responsavel') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="x in ciclo.data.value.testes" :key="x.id">
              <td>{{ x.sequencia }}</td>
              <td>{{ x.descricao }}</td>
              <td>{{ t(`cirurgia.cmeCiclo.resultados.${x.resultado}`) }}</td>
              <td>{{ x.lote ?? t('cirurgia.cmeCiclo.nenhum') }}</td>
              <td>{{ x.leitura ?? t('cirurgia.cmeCiclo.nenhum') }}</td>
              <td>{{ x.responsavel ?? t('cirurgia.cmeCiclo.nenhum') }}</td>
            </tr>
          </tbody>
        </table>

        <form v-if="podeTestar" class="filtros" data-testid="cme-teste-form" @submit.prevent="salvarTeste">
          <SanteSelecao
            v-model="teste.tipo"
            :rotulo="t('cirurgia.cmeCiclo.tipo')"
            :opcoes="opcTipos"
            data-testid="cme-teste-tipo"
          />
          <SanteSelecao
            v-model="teste.resultado"
            :rotulo="t('cirurgia.cmeCiclo.resultado')"
            :opcoes="opcResultados"
            data-testid="cme-teste-resultado"
          />
          <label
            >{{ t('cirurgia.cmeCiclo.loteIndicador') }}
            <input v-model="teste.lote" maxlength="30" data-testid="cme-teste-lote"
          /></label>
          <label
            >{{ t('cirurgia.cmeCiclo.validade') }}
            <input v-model="teste.validade" type="date" data-testid="cme-teste-validade"
          /></label>
          <label
            >{{ t('cirurgia.cmeCiclo.incubacao') }}
            <input v-model="teste.incubacaoInicio" type="datetime-local" data-testid="cme-teste-incubacao"
          /></label>
          <label
            >{{ t('cirurgia.cmeCiclo.leitura') }}
            <input v-model="teste.leitura" type="datetime-local" data-testid="cme-teste-leitura"
          /></label>
          <label
            >{{ t('cirurgia.cmeCiclo.valorMedido') }}
            <input v-model="teste.valorMedido" maxlength="100" data-testid="cme-teste-valor"
          /></label>
          <label v-if="tipoEscolhido?.exigeControle"
            ><input v-model="teste.controlePositivoOk" type="checkbox" data-testid="cme-teste-controle" />
            {{ t('cirurgia.cmeCiclo.controle') }}</label
          >
          <label
            >{{ t('cirurgia.cmeCiclo.observacao') }}
            <input v-model="teste.observacao" maxlength="500" data-testid="cme-teste-observacao"
          /></label>
          <button type="submit" :disabled="teste.tipo === null" data-testid="cme-teste-registrar">
            {{ t('cirurgia.cmeCiclo.registrar') }}
          </button>
          <button type="button" data-testid="cme-ciclo-encerrar" @click="encerrar">
            {{ t('cirurgia.cmeCiclo.encerrar') }}
          </button>
        </form>

        <h2>{{ t('cirurgia.cmeCiclo.pacotes') }}</h2>
        <table data-testid="cme-ciclo-pacotes">
          <thead>
            <tr>
              <th scope="col">{{ t('cirurgia.cmeCiclo.etiqueta') }}</th>
              <th scope="col">{{ t('cirurgia.cmeCiclo.situacaoCiclo') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in ciclo.data.value.pacotes" :key="p.id">
              <td>{{ p.etiqueta }}</td>
              <td>{{ situacao(p.situacao) }}</td>
            </tr>
          </tbody>
        </table>

        <h2>{{ t('cirurgia.cmeCiclo.rejeicao') }}</h2>
        <form class="filtros" data-testid="cme-rejeicao-form" @submit.prevent="salvarRejeicao">
          <SanteSelecao
            v-model="rej.objeto"
            :rotulo="t('cirurgia.cmeCiclo.objeto')"
            :opcoes="opcObjetos"
            data-testid="cme-rejeicao-objeto"
          />
          <SanteSelecao
            v-if="rej.objeto === 'pacote'"
            v-model="rej.pacote"
            :rotulo="t('cirurgia.cmeCiclo.pacote')"
            :opcoes="opcPacotes"
            data-testid="cme-rejeicao-pacote"
          />
          <SanteSelecao
            v-model="rej.motivo"
            :rotulo="t('cirurgia.cmeCiclo.motivo')"
            :opcoes="opcMotivos"
            data-testid="cme-rejeicao-motivo"
          />
          <SanteSelecao
            v-model="rej.fase"
            :rotulo="t('cirurgia.cmeCiclo.fase')"
            :opcoes="opcFases"
            data-testid="cme-rejeicao-fase"
          />
          <label
            ><input v-model="rej.retorna" type="checkbox" data-testid="cme-rejeicao-retorna" />
            {{ t('cirurgia.cmeCiclo.retorna') }}</label
          >
          <SanteSelecao
            v-if="rej.retorna"
            v-model="rej.faseRetorno"
            :rotulo="t('cirurgia.cmeCiclo.faseRetorno')"
            :opcoes="opcFases"
            data-testid="cme-rejeicao-fase-retorno"
          />
          <label
            >{{ t('cirurgia.cmeCiclo.descricao') }}
            <input v-model="rej.descricao" maxlength="500" data-testid="cme-rejeicao-descricao"
          /></label>
          <button
            type="submit"
            :disabled="rej.motivo === null || rej.fase === null"
            data-testid="cme-rejeicao-salvar"
          >
            {{ t('cirurgia.cmeCiclo.rejeitar') }}
          </button>
        </form>
      </template>

      <h2>{{ t('cirurgia.cmeCiclo.rejeicoes') }}</h2>
      <p v-if="!painel.data.value.rejeicoes.length">{{ t('cirurgia.cmeCiclo.semRejeicoes') }}</p>
      <table v-else data-testid="cme-rejeicoes">
        <thead>
          <tr>
            <th scope="col">{{ t('cirurgia.cmeCiclo.quando') }}</th>
            <th scope="col">{{ t('cirurgia.cmeCiclo.objeto') }}</th>
            <th scope="col">{{ t('cirurgia.cmeCiclo.motivo') }}</th>
            <th scope="col">{{ t('cirurgia.cmeCiclo.situacaoCiclo') }}</th>
            <th scope="col">{{ t('cirurgia.cmeCiclo.recolhidos') }}</th>
            <th scope="col">{{ t('cirurgia.cmeCiclo.pendentes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in painel.data.value.rejeicoes" :key="r.id" :data-testid="`cme-rejeicao-${r.id}`">
            <td>{{ r.rejeitadoEm ?? t('cirurgia.cmeCiclo.nenhum') }}</td>
            <td>{{ r.etiqueta ?? r.numeroCiclo ?? t('cirurgia.cmeCiclo.nenhum') }}</td>
            <td>{{ r.motivo }} · {{ r.fase }}</td>
            <td>{{ situacao(r.situacao) }}</td>
            <td>{{ r.recolhidos }}</td>
            <td>
              {{ r.pendentes }}
              <template v-if="r.situacao === 'em_recolhimento' && doCiclo(r)">
                <button
                  v-for="p in distribuidos"
                  :key="p.id"
                  type="button"
                  :data-testid="`cme-recolher-${r.id}-${p.id}`"
                  @click="recolherPacote(r.id, p.id)"
                >
                  {{ t('cirurgia.cmeCiclo.recolher') }} {{ p.etiqueta }}
                </button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
