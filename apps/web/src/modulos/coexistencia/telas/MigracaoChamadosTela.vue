<script setup lang="ts">
// Migração gradual: chamados (M37, ficha seção 7; regra 7): os chamados por severidade e prazo (vencidos em destaque;
// S1 com a próxima atualização devida), com a triagem do N1 e do N2 (severidade, nível, situação, comandante do S1 e o
// contorno pelo outro sistema). Os prazos vigentes aparecem "a aprovar" até a diretoria aprovar os parâmetros.
// Filtros (severidade, situação, onde aconteceu, setor e período) e 50 por página, lidos no banco.
import type { ChamadoLido, TriarChamado } from '@sgh/contratos';
import { NIVEIS_SUPORTE, SEVERIDADES_CHAMADO, SISTEMAS_CHAMADO, SITUACOES_CHAMADO } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import { lerChamados, lerSetores, triarChamado } from '../api.js';
import AbasMigracao from '../componentes/AbasMigracao.vue';

const { t } = useI18n();
const { permissoes } = usarSessao();
const cliente = useQueryClient();
const filtroForm = reactive({ severidade: '', situacao: '', sistema: '', setor: '', dias: '' });
const filtro = ref<{
  severidade?: string;
  situacao?: string;
  sistema?: string;
  setor?: string;
  dias?: number;
  pagina: number;
}>({ pagina: 1 });
const consulta = useQuery({
  queryKey: computed(() => ['coexistencia', 'chamados', filtro.value]),
  queryFn: () => lerChamados(filtro.value),
});
const setores = useQuery({ queryKey: ['coexistencia', 'setores'], queryFn: lerSetores });
const pode = computed(() => permissoes.value.has('config.chamado.triar'));
const aberto = ref<ChamadoLido | null>(null);
const triagem = reactive<{
  severidade: TriarChamado['severidade'];
  situacao: TriarChamado['situacao'];
  nivel: TriarChamado['nivel'];
  comandante: string;
  contorno: string;
}>({
  severidade: 'S3',
  situacao: 'em-atendimento',
  nivel: 'N1',
  comandante: '',
  contorno: '',
});
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const op = <T extends string>(l: readonly T[], prefixo: string) =>
  l.map((v) => ({ valor: v, rotulo: prefixo ? t(`${prefixo}.${v}`) : v }));
const opSev = op(SEVERIDADES_CHAMADO, '');
const opSit = op(SITUACOES_CHAMADO, 'coexistencia.chamados.situacoes');
const opNivel = op(NIVEIS_SUPORTE, '');
const todos = { valor: '', rotulo: t('coexistencia.todos') };
const opFiltroSev = [todos, ...opSev];
const opFiltroSit = [todos, ...opSit];
const opFiltroSis = [todos, ...op(SISTEMAS_CHAMADO, 'coexistencia.chamados.sistemas')];
const opFiltroDias = [
  todos,
  ...[1, 7, 30, 90].map((n) => ({ valor: String(n), rotulo: t('coexistencia.chamados.ultimosDias', { n }) })),
];
const opFiltroSetor = computed(() => [
  todos,
  ...(setores.data.value?.setores ?? []).map((s) => ({ valor: s.codigo, rotulo: s.nome })),
]);
function filtrar(): void {
  filtro.value = {
    ...(filtroForm.severidade ? { severidade: filtroForm.severidade } : {}),
    ...(filtroForm.situacao ? { situacao: filtroForm.situacao } : {}),
    ...(filtroForm.sistema ? { sistema: filtroForm.sistema } : {}),
    ...(filtroForm.setor ? { setor: filtroForm.setor } : {}),
    ...(filtroForm.dias ? { dias: Number(filtroForm.dias) } : {}),
    pagina: 1,
  };
}
function irPara(n: number): void {
  filtro.value = { ...filtro.value, pagina: n };
}

function abrir(c: ChamadoLido): void {
  aberto.value = c;
  triagem.severidade = c.severidade;
  triagem.situacao = c.situacao === 'aberto' ? 'em-atendimento' : c.situacao;
  triagem.nivel = c.nivel;
  triagem.comandante = c.comandante ?? '';
  triagem.contorno = c.contorno ?? '';
  erro.value = null;
}

async function triar(): Promise<void> {
  if (!aberto.value) return;
  erro.value = null;
  try {
    const r = await triarChamado(aberto.value.id, {
      severidade: triagem.severidade,
      situacao: triagem.situacao,
      nivel: triagem.nivel,
      comandante: triagem.comandante.trim() || null,
      ...(triagem.contorno.trim() ? { contorno: triagem.contorno.trim() } : {}),
    });
    mensagem.value = t('coexistencia.chamados.triado', {
      id: r.id,
      situacao: t(`coexistencia.chamados.situacoes.${r.situacao}`),
    });
    aberto.value = null;
    await cliente.invalidateQueries({ queryKey: ['coexistencia', 'chamados'] });
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="titulo-chamados" data-testid="tela-migracao-chamados">
    <h1 id="titulo-chamados">{{ t('coexistencia.chamados.titulo') }}</h1>
    <AbasMigracao atual="chamados" />
    <p>{{ t('coexistencia.chamados.texto') }}</p>
    <form
      class="filtros"
      :aria-label="t('coexistencia.filtros')"
      data-testid="filtros-chamados"
      @submit.prevent="filtrar"
    >
      <SanteSelecao
        id="chamados-severidade"
        v-model="filtroForm.severidade"
        :rotulo="t('coexistencia.chamados.severidade')"
        :opcoes="opFiltroSev"
        data-testid="filtro-severidade"
      />
      <SanteSelecao
        id="chamados-situacao"
        v-model="filtroForm.situacao"
        :rotulo="t('coexistencia.situacao')"
        :opcoes="opFiltroSit"
        data-testid="filtro-situacao"
      />
      <SanteSelecao
        id="chamados-sistema"
        v-model="filtroForm.sistema"
        :rotulo="t('coexistencia.chamados.sistema')"
        :opcoes="opFiltroSis"
        data-testid="filtro-sistema"
      />
      <SanteSelecao
        id="chamados-setor"
        v-model="filtroForm.setor"
        :rotulo="t('coexistencia.setor')"
        :opcoes="opFiltroSetor"
        data-testid="filtro-setor"
      />
      <SanteSelecao
        id="chamados-dias"
        v-model="filtroForm.dias"
        :rotulo="t('coexistencia.chamados.periodo')"
        :opcoes="opFiltroDias"
        data-testid="filtro-dias"
      />
      <SanteBotao
        :rotulo="t('coexistencia.buscar')"
        variante="secundario"
        tipo="submit"
        data-testid="chamados-filtrar"
      />
    </form>
    <MensagemErro v-if="consulta.error.value" :erro="consulta.error.value" />
    <p v-else-if="!consulta.data.value" role="status">{{ t('coexistencia.carregando') }}</p>
    <template v-else>
      <p data-testid="chamados-prazos">
        {{
          t('coexistencia.chamados.prazos', {
            lista: consulta.data.value.prazos
              .map(
                (p) =>
                  `${p.severidade}: ${p.diaUtil ? t('coexistencia.chamados.diasUteis', { r: p.respostaMin, c: p.solucaoMin }) : t('coexistencia.chamados.minutos', { r: p.respostaMin, c: p.solucaoMin })}`,
              )
              .join('; '),
            situacao: consulta.data.value.prazos[0]?.aprovado
              ? t('coexistencia.chamados.aprovados')
              : t('coexistencia.chamados.aAprovar'),
          })
        }}
      </p>
      <p data-testid="chamados-total">
        {{ t('coexistencia.chamados.total', { n: consulta.data.value.total }) }}
      </p>
      <p v-if="consulta.data.value.itens.length === 0">{{ t('coexistencia.nenhum') }}</p>
      <table v-else class="tabela" data-testid="tabela-chamados">
        <caption>
          {{
            t('coexistencia.chamados.legenda')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('coexistencia.chamados.numero') }}</th>
            <th scope="col">{{ t('coexistencia.chamados.severidade') }}</th>
            <th scope="col">{{ t('coexistencia.chamados.sistema') }}</th>
            <th scope="col">{{ t('coexistencia.situacao') }}</th>
            <th scope="col">{{ t('coexistencia.chamados.prazo') }}</th>
            <th scope="col">{{ t('coexistencia.chamados.descricao') }}</th>
            <th v-if="pode" scope="col">
              <span class="sgh-visualmente-oculto">{{ t('coexistencia.acoes') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="c in consulta.data.value.itens"
            :key="c.id"
            :data-testid="`chamado-${c.id}`"
            :class="{ alerta: c.vencido }"
          >
            <th scope="row">{{ c.id }}</th>
            <td data-testid="severidade">{{ c.severidade }}</td>
            <td>{{ t(`coexistencia.chamados.sistemas.${c.sistema}`) }}</td>
            <td data-testid="situacao-chamado">{{ t(`coexistencia.chamados.situacoes.${c.situacao}`) }}</td>
            <td>
              {{ c.prazoResposta }}<span v-if="c.vencido"> ({{ t('coexistencia.chamados.vencido') }})</span>
              <span v-if="c.proximaAtualizacao"
                ><br />{{ t('coexistencia.chamados.proxima', { quando: c.proximaAtualizacao }) }}</span
              >
            </td>
            <td>
              {{ c.descricao }}
              <span v-if="c.dadoPessoal"><br />{{ t('coexistencia.chamados.encarregado') }}</span>
            </td>
            <td v-if="pode">
              <SanteBotao
                :rotulo="t('coexistencia.chamados.triar')"
                variante="texto"
                :data-testid="`triar-${c.id}`"
                @acionar="abrir(c)"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <nav
        v-if="consulta.data.value.total > consulta.data.value.tamanho"
        :aria-label="t('coexistencia.paginas')"
        class="filtros"
      >
        <SanteBotao
          v-if="consulta.data.value.pagina > 1"
          :rotulo="t('coexistencia.anterior')"
          variante="texto"
          data-testid="chamados-anterior"
          @acionar="irPara(consulta.data.value.pagina - 1)"
        />
        <SanteBotao
          v-if="consulta.data.value.pagina * consulta.data.value.tamanho < consulta.data.value.total"
          :rotulo="t('coexistencia.proxima')"
          variante="texto"
          data-testid="chamados-proxima"
          @acionar="irPara(consulta.data.value.pagina + 1)"
        />
      </nav>
      <form v-if="aberto" class="filtros" data-testid="form-triagem" @submit.prevent="triar">
        <h2>{{ t('coexistencia.chamados.triagemDe', { id: aberto.id }) }}</h2>
        <SanteSelecao
          id="triagem-severidade"
          v-model="triagem.severidade"
          :rotulo="t('coexistencia.chamados.severidade')"
          :opcoes="opSev"
          data-testid="triagem-severidade"
        />
        <SanteSelecao
          id="triagem-situacao"
          v-model="triagem.situacao"
          :rotulo="t('coexistencia.situacao')"
          :opcoes="opSit"
          data-testid="triagem-situacao"
        />
        <SanteSelecao
          id="triagem-nivel"
          v-model="triagem.nivel"
          :rotulo="t('coexistencia.chamados.nivel')"
          :opcoes="opNivel"
          data-testid="triagem-nivel"
        />
        <div class="campo">
          <label for="triagem-comandante">{{ t('coexistencia.chamados.comandante') }}</label>
          <input
            id="triagem-comandante"
            v-model="triagem.comandante"
            maxlength="31"
            data-testid="triagem-comandante"
          />
        </div>
        <SanteCampoTexto
          v-model="triagem.contorno"
          :rotulo="t('coexistencia.chamados.contorno')"
          :max-bytes="400"
          data-testid="triagem-contorno"
        />
        <SanteBotao
          :rotulo="t('coexistencia.gravar')"
          variante="primario"
          tipo="submit"
          data-testid="triagem-gravar"
        />
      </form>
      <SanteAlerta
        v-if="mensagem"
        :texto="mensagem"
        variante="info"
        anunciar
        data-testid="mensagem-chamados"
      />
      <MensagemErro v-if="erro" :erro="erro" />
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
