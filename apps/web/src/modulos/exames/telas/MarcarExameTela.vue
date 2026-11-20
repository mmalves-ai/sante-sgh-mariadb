<script setup lang="ts">
// Marcação de exames (ficha do M18, seção 7): `/agenda/exames/marcar`. Busca de vaga por agenda, categoria, convênio
// aceito e exame coberto (próximas vagas quando a janela não tem); o aviso de "marcação incompleta" e de "confirmado
// sem paciente" nos horários da agenda; o paciente do cadastro único (com o prontuário), o exame escolhido no
// catálogo, o solicitante, o convênio, o canal e o recado → agenda.agendarExame. A marcação para quem ainda não tem
// prontuário fica desligada até a prova na cópia (POL-3), com o motivo.
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import type { BuscaVagasExame, GradeExame, ResultadoBuscaPaciente } from '@sgh/contratos';
import { buscarPacientes } from '../../cadastro/api-cadastro.js';
import { dataBr, horaBr, horaDoContrato } from '../../agenda/formato.js';
import {
  buscarVagasExame,
  lerExamesDoPaciente,
  lerGradeExame,
  marcarExame,
  novaChave,
} from '../api-exames.js';
import AvisoExame from '../componentes/AvisoExame.vue';
import ErroExame from '../componentes/ErroExame.vue';
import { usarExames } from '../usar-exames.js';

const { t } = useI18n();
const rota = useRoute();
const roteador = useRouter();
const cliente = useQueryClient();
const { opcoes, opcoesAgenda, pode, motivoGravacao, convenios, gravacao, agendas } = usarExames();
const q = (k: string) => (typeof rota.query[k] === 'string' ? (rota.query[k] as string) : '');
const comVazio = (l: { valor: string; rotulo: string }[], rotulo = t('exames.escolha')) => [
  { valor: '', rotulo },
  ...l,
];

// ── Busca de vaga ──
const fAgenda = ref(q('agenda'));
const fCategoria = ref('');
const fConvenio = ref('');
const fExame = ref('');
const fDe = ref(q('data'));
const fAte = ref(q('data'));
const busca = ref<BuscaVagasExame | null>(null);
const grade = ref<GradeExame | null>(null);
const erroBusca = ref<unknown>(null);
const escolhasAgenda = computed(() => comVazio(opcoesAgenda.value, t('exames.todasAgendas')));
const categorias = computed(() =>
  comVazio(
    (opcoes.data.value?.categorias ?? []).map((c) => ({ valor: String(c.codigo), rotulo: c.rotulo })),
    t('exames.todasCategorias'),
  ),
);
const escolhasConvenio = computed(() => comVazio(convenios.value));
const exames = computed(() =>
  (opcoes.data.value?.exames ?? []).map((e) => ({ valor: String(e.id), rotulo: e.nome })),
);
async function procurar(): Promise<void> {
  erroBusca.value = null;
  grade.value = null;
  try {
    busca.value = await buscarVagasExame({
      agenda: fAgenda.value ? Number(fAgenda.value) : null,
      categoria: fCategoria.value ? Number(fCategoria.value) : null,
      convenio: fConvenio.value ? Number(fConvenio.value) : null,
      exame: fExame.value ? Number(fExame.value) : null,
      de: fDe.value || null,
      ate: fAte.value || null,
    });
    if (fAgenda.value)
      grade.value = await lerGradeExame(Number(fAgenda.value), busca.value.de, busca.value.ate);
  } catch (e) {
    erroBusca.value = e;
  }
}

// ── Vaga escolhida ──
interface Escolha {
  agenda: number;
  agendaNome: string;
  data: string;
  hora: string;
  exame: string;
}
const escolha = ref<Escolha | null>(null);
function escolher(v: Escolha): void {
  escolha.value = { ...v };
  if (fConvenio.value) convenio.value = fConvenio.value;
  if (fExame.value) exame.value = fExame.value;
}
const categoriaDaEscolha = computed(() => {
  const a = agendas.data.value?.itens.find((x) => x.id === escolha.value?.agenda);
  return a?.categoria.codigo ?? null;
});
const examesDaEscolha = computed(() =>
  comVazio(
    (opcoes.data.value?.exames ?? [])
      .filter(
        (e) =>
          categoriaDaEscolha.value === null ||
          categoriaDaEscolha.value === 42 ||
          e.categoria === categoriaDaEscolha.value,
      )
      .map((e) => ({ valor: String(e.id), rotulo: e.nome })),
    t('exames.marcar.exameDepois'),
  ),
);

// ── Paciente ──
const termo = ref('');
const pedidoPaciente = ref('');
const pacientes = useQuery({
  queryKey: computed(() => ['exames', 'pacientes', pedidoPaciente.value]),
  queryFn: (): Promise<ResultadoBuscaPaciente> => buscarPacientes(pedidoPaciente.value),
  enabled: computed(() => pedidoPaciente.value.length >= 2),
});
const paciente = ref<{ id: number; nome: string } | null>(null);
const historico = useQuery({
  queryKey: computed(() => ['exames', 'paciente', paciente.value?.id ?? 0]),
  queryFn: () => lerExamesDoPaciente(paciente.value?.id ?? 0),
  enabled: computed(() => paciente.value !== null),
});

// ── Marcação ──
const convenio = ref('');
const exame = ref('');
const comSolicitante = ref(false);
const solCrm = ref('');
const solUf = ref('');
const solNome = ref('');
const retorno = ref(false);
const canal = ref('telefone');
const observacao = ref('');
const chave = ref(novaChave('marcar-exame'));
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);
const canais = computed(() =>
  (opcoes.data.value?.canais ?? []).map((c) => ({ valor: c.codigo, rotulo: c.rotulo })),
);
const podeMarcar = pode('agenda.agendarExame');
const semProntuario = computed(
  () => gravacao.data.value?.operacoes['agenda.agendarExameSemProntuario'] ?? null,
);
const solicitanteValido = computed(
  () =>
    !comSolicitante.value ||
    (/^\d{1,7}$/.test(solCrm.value) && /^[A-Za-z]{2}$/.test(solUf.value) && solNome.value.trim().length >= 3),
);
const pronto = computed(
  () => escolha.value !== null && paciente.value !== null && convenio.value !== '' && solicitanteValido.value,
);

async function marcar(): Promise<void> {
  const e = escolha.value;
  const p = paciente.value;
  if (!e || !p) return;
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = await marcarExame(
      {
        agenda: e.agenda,
        data: e.data,
        hora: horaDoContrato(e.hora) ?? e.hora,
        paciente: p.id,
        convenio: Number(convenio.value),
        exame: exame.value ? Number(exame.value) : null,
        solicitante: comSolicitante.value
          ? { crm: Number(solCrm.value), uf: solUf.value.toUpperCase(), nome: solNome.value }
          : null,
        retorno: retorno.value,
        canal: canal.value,
        ...(observacao.value.trim() ? { observacao: observacao.value } : {}),
      },
      chave.value,
    );
    mensagem.value = r.mensagem;
    chave.value = novaChave('marcar-exame');
    await cliente.invalidateQueries({ queryKey: ['exames'] });
    const id = Number(r.resultado['marcacao']);
    if (id) await roteador.push(`/agenda/exames/marcacoes/${id}`);
  } catch (x) {
    erro.value = x;
    chave.value = novaChave('marcar-exame');
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="marcar-exame-titulo" data-testid="tela-marcar-exame">
    <h1 id="marcar-exame-titulo">{{ t('exames.marcar.titulo') }}</h1>
    <p>{{ t('exames.marcar.texto') }}</p>
    <AvisoExame :motivo="motivoGravacao" />
    <p class="acoes">
      <RouterLink to="/agenda/exames/dia">{{ t('exames.dia.titulo') }}</RouterLink>
      <RouterLink to="/agenda/exames/cancelamentos">{{ t('exames.cancelamentos.titulo') }}</RouterLink>
      <RouterLink to="/agenda/exames/residuo">{{ t('exames.residuo.titulo') }}</RouterLink>
    </p>

    <section class="painel" aria-labelledby="marcar-exame-busca">
      <h2 id="marcar-exame-busca">{{ t('exames.marcar.buscar') }}</h2>
      <form class="filtros" role="search" @submit.prevent="procurar">
        <SanteSelecao v-model="fAgenda" :rotulo="t('exames.agenda')" :opcoes="escolhasAgenda" />
        <SanteSelecao v-model="fCategoria" :rotulo="t('exames.categoria')" :opcoes="categorias" />
        <SanteSelecao v-model="fConvenio" :rotulo="t('exames.convenio')" :opcoes="escolhasConvenio" />
        <SanteSelecao
          v-model="fExame"
          :rotulo="t('exames.exame')"
          :opcoes="comVazio(exames, t('exames.qualquerExame'))"
        />
        <div class="campo">
          <label for="marcar-exame-de">{{ t('exames.de') }}</label>
          <input id="marcar-exame-de" v-model="fDe" type="date" data-testid="vagas-exame-de" />
        </div>
        <div class="campo">
          <label for="marcar-exame-ate">{{ t('exames.ate') }}</label>
          <input id="marcar-exame-ate" v-model="fAte" type="date" data-testid="vagas-exame-ate" />
        </div>
        <SanteBotao tipo="submit" :rotulo="t('exames.marcar.buscar')" />
      </form>
      <ErroExame v-if="erroBusca" :erro="erroBusca" />
      <div v-if="grade && grade.residuo.total > 0" role="status" data-testid="aviso-incompleta">
        <SanteAlerta
          variante="aviso"
          :texto="
            t('exames.marcar.avisoResiduo', {
              incompletas: grade.residuo.ocupadosSemMarcacao,
              confirmados: grade.residuo.confirmadosSemPaciente,
            })
          "
        />
      </div>
      <template v-if="busca">
        <SanteAlerta v-if="busca.truncado" variante="info" :texto="t('exames.truncado')" />
        <table v-if="busca.itens.length" class="tabela" data-testid="tabela-vagas-exame">
          <caption>
            {{
              t('exames.marcar.vagas', { n: busca.itens.length })
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('exames.agenda') }}</th>
              <th scope="col">{{ t('exames.categoria') }}</th>
              <th scope="col">{{ t('exames.data') }}</th>
              <th scope="col">{{ t('exames.hora') }}</th>
              <th scope="col">{{ t('exames.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="v in busca.itens" :key="`${v.agenda}-${v.data}-${v.hora}`">
              <td>{{ v.agendaNome }}</td>
              <td>{{ v.categoria }}</td>
              <td>{{ dataBr(v.data) }}</td>
              <td>{{ v.hora }}</td>
              <td>
                <SanteBotao
                  variante="texto"
                  :rotulo="
                    t('exames.marcar.escolher', { data: dataBr(v.data), hora: v.hora, agenda: v.agendaNome })
                  "
                  :data-testid="`vaga-exame-${v.agenda}-${v.data}-${v.hora.replace(':', '')}`"
                  @acionar="escolher(v)"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else>{{ t('exames.marcar.semVagas') }}</p>
        <section v-if="busca.proximas.length" aria-labelledby="marcar-exame-proximas">
          <h3 id="marcar-exame-proximas">{{ t('exames.marcar.proximas') }}</h3>
          <ul>
            <li v-for="p in busca.proximas" :key="`${p.agenda}-${p.data}-${p.hora}`">
              <SanteBotao
                variante="texto"
                :rotulo="
                  t('exames.marcar.escolher', { data: dataBr(p.data), hora: p.hora, agenda: p.agendaNome })
                "
                @acionar="escolher(p)"
              />
            </li>
          </ul>
        </section>
      </template>
    </section>

    <section class="painel" aria-labelledby="marcar-exame-paciente">
      <h2 id="marcar-exame-paciente">{{ t('exames.marcar.buscarPaciente') }}</h2>
      <form class="filtros" role="search" @submit.prevent="pedidoPaciente = termo.trim()">
        <div class="campo">
          <label for="marcar-exame-termo">{{ t('exames.marcar.termoPaciente') }}</label>
          <input
            id="marcar-exame-termo"
            v-model="termo"
            type="search"
            autocomplete="off"
            data-testid="marcar-exame-termo"
          />
        </div>
        <SanteBotao tipo="submit" :rotulo="t('exames.marcar.buscarPaciente')" />
      </form>
      <ErroExame v-if="pacientes.isError.value" :erro="pacientes.error.value" />
      <ul v-else-if="pacientes.data.value && !paciente">
        <li v-for="p in pacientes.data.value.itens" :key="p.id">
          <SanteBotao
            variante="texto"
            :rotulo="t('exames.marcar.escolherPaciente', { nome: p.nomeSocial ?? p.nome })"
            :data-testid="`paciente-exame-${p.id}`"
            @acionar="paciente = { id: p.id, nome: p.nomeSocial ?? p.nome }"
          />
        </li>
      </ul>
      <p v-if="paciente" class="acoes" data-testid="paciente-exame-escolhido">
        {{ t('exames.marcar.pacienteEscolhido', { nome: paciente.nome }) }}
        <SanteBotao variante="texto" :rotulo="t('exames.trocar')" @acionar="paciente = null" />
      </p>
      <section v-if="paciente && historico.data.value?.itens.length" aria-labelledby="marcar-exame-historico">
        <h3 id="marcar-exame-historico">{{ t('exames.marcar.examesDoPaciente') }}</h3>
        <ul>
          <li v-for="m in historico.data.value.itens.slice(0, 10)" :key="m.id">
            <RouterLink :to="`/agenda/exames/marcacoes/${m.id}`">
              {{ dataBr(m.data) }} {{ m.hora }} · {{ m.agendaNome }} · {{ m.estadoRotulo }}
            </RouterLink>
          </li>
        </ul>
      </section>
    </section>

    <section class="painel" aria-labelledby="marcar-exame-dados">
      <h2 id="marcar-exame-dados">{{ t('exames.marcar.marcar') }}</h2>
      <p v-if="escolha" data-testid="vaga-exame-escolhida">
        {{
          t('exames.marcar.escolhida', {
            agenda: escolha.agendaNome,
            data: dataBr(escolha.data),
            hora: horaBr(escolha.hora),
          })
        }}
      </p>
      <div class="filtros">
        <SanteSelecao v-model="convenio" :rotulo="t('exames.convenio')" :opcoes="escolhasConvenio" />
        <SanteSelecao v-model="exame" :rotulo="t('exames.marcar.exameEscolhido')" :opcoes="examesDaEscolha" />
        <SanteSelecao v-model="canal" :rotulo="t('exames.canal')" :opcoes="canais" />
        <label><input v-model="retorno" type="checkbox" /> {{ t('exames.marcar.retorno') }}</label>
        <label
          ><input v-model="comSolicitante" type="checkbox" /> {{ t('exames.marcar.comSolicitante') }}</label
        >
      </div>
      <fieldset v-if="comSolicitante" class="filtros">
        <legend>{{ t('exames.marcar.solicitante') }}</legend>
        <div class="campo">
          <label for="sol-crm">{{ t('exames.marcar.crm') }}</label>
          <input id="sol-crm" v-model="solCrm" inputmode="numeric" maxlength="7" />
        </div>
        <div class="campo">
          <label for="sol-uf">{{ t('exames.marcar.uf') }}</label>
          <input id="sol-uf" v-model="solUf" maxlength="2" />
        </div>
        <SanteCampoTexto v-model="solNome" :rotulo="t('exames.marcar.nomeSolicitante')" :max-bytes="70" />
      </fieldset>
      <SanteCampoTexto v-model="observacao" :rotulo="t('exames.observacao')" :max-bytes="500" multilinha />
      <SanteBotao
        v-if="podeMarcar"
        :rotulo="t('exames.marcar.marcar')"
        :desabilitado="!pronto || ocupado"
        data-testid="botao-marcar-exame"
        @acionar="marcar"
      />
      <p v-if="mensagem" role="status">{{ mensagem }}</p>
      <ErroExame v-if="erro" :erro="erro" />
    </section>

    <section class="painel" aria-labelledby="marcar-exame-sem-prontuario">
      <h2 id="marcar-exame-sem-prontuario">{{ t('exames.marcar.semProntuario') }}</h2>
      <p>{{ t('exames.marcar.semProntuarioTexto') }}</p>
      <SanteAlerta
        v-if="semProntuario && !semProntuario.pode"
        variante="info"
        :texto="t('exames.marcar.semProntuarioDesligada')"
      />
    </section>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
